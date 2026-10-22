import { collection, deleteDoc, doc, getDoc, getDocsFromServer, query, setDoc, where } from 'firebase/firestore';
import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase/config';
import { loadStored, storeItem, unstoreItem, type StoredItem } from './wardrobeStorage';

// Photos stay in Storage; Firestore holds account-owned metadata, not temporary blob URLs.
export async function saveWardrobeItem(userId: string, item: StoredItem) {
  const photo = (side: string) => `users/${userId}/clothing-items/${item.id}_${side}`;
  await Promise.all([
    uploadBytes(ref(storage, photo('front')), item.front),
    uploadBytes(ref(storage, photo('back')), item.back),
  ]);
  const { front, back, ...metadata } = item;
  // Firestore rejects undefined optional fields.
  await setDoc(doc(db, 'clothingItems', item.id), JSON.parse(JSON.stringify({
    ...metadata, userId, source: 'fitlab', frontPath: photo('front'), backPath: photo('back'),
  })));
}

export async function loadWardrobeItems(userId: string) {
  // A single-field query avoids requiring a newly deployed composite index.
  const snapshot = await getDocsFromServer(query(collection(db, 'clothingItems'), where('userId', '==', userId)));
  const documents = snapshot.docs.filter(d => d.data().source === 'fitlab');
  const results = await Promise.allSettled(documents.map(async d => {
    const { userId: owner, source, frontPath, backPath, ...metadata } = d.data();
    const [front, back] = await Promise.all([getBlob(ref(storage, frontPath)), getBlob(ref(storage, backPath))]);
    return { ...metadata, ownerId: userId, cloudSynced: true, id: d.id, front, back } as StoredItem;
  }));
  return {
    items: results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []),
    ids: documents.map(d => d.id),
    failed: results.filter(r => r.status === 'rejected').length,
  };
}

export async function deleteWardrobeItem(userId: string, id: string) {
  const itemRef = doc(db, 'clothingItems', id);
  const saved = await getDoc(itemRef);
  if (saved.exists() && saved.data().userId !== userId) throw new Error('This item belongs to another account.');
  // Remove metadata first so a partially failed photo cleanup cannot resurrect a deleted item.
  await deleteDoc(itemRef);
  await Promise.allSettled(['front', 'back'].map(side => deleteObject(ref(storage, `users/${userId}/clothing-items/${id}_${side}`))));
}

// Remote records are authoritative after a successful sync; unsynced legacy copies are migrated.
export async function syncWardrobe(userId: string, warn: (message: string) => void) {
  const local = await loadStored(userId).catch(() => { warn('Browser wardrobe storage is unavailable.'); return []; });
  let remote: Awaited<ReturnType<typeof loadWardrobeItems>>;
  try { remote = await loadWardrobeItems(userId); }
  catch { warn('Could not load your saved wardrobe. Showing this browser’s copies.'); return local; }
  if (remote.failed) warn('Some saved photos could not load. Please refresh to retry.');
  const ids = new Set(remote.ids);
  const kept = local.filter(r => !r.cloudSynced || ids.has(r.id));
  for (const r of local) if (r.cloudSynced && !ids.has(r.id)) await unstoreItem(r.id).catch(() => undefined);
  const merged = new Map(kept.map(r => [r.id, r]));
  for (const r of remote.items) { merged.set(r.id, r); await storeItem(r).catch(() => undefined); }
  for (const r of kept) if (!ids.has(r.id)) {
    try {
      await saveWardrobeItem(userId, r);
      const saved = { ...r, cloudSynced: true };
      merged.set(r.id, saved);
      await storeItem(saved).catch(() => undefined);
    } catch { warn('Some clothes are saved only in this browser. Account sync failed; please retry later.'); }
  }
  return [...merged.values()];
}
