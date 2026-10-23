import { collection, deleteDoc, doc, getDoc, getDocsFromServer, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase/config';
import { loadStored, storeItem, unstoreItem, type StoredItem, type StoredUvMap } from './wardrobeStorage';

// Photos stay in Storage; Firestore holds account-owned metadata, not temporary blob URLs.
export async function saveWardrobeItem(userId: string, item: StoredItem) {
  const photo = (side: string) => `users/${userId}/clothing-items/${item.id}_${side}`;
  const uploads: Promise<unknown>[] = [
    uploadBytes(ref(storage, photo('front')), item.front),
    uploadBytes(ref(storage, photo('back')), item.back),
  ];
  if (item.uv) uploads.push(uploadBytes(ref(storage, photo('uv_front')), item.uv.front), uploadBytes(ref(storage, photo('uv_back')), item.uv.back));
  await Promise.all(uploads);
  const { front, back, uv, ...metadata } = item;
  // Firestore rejects undefined optional fields.
  await setDoc(doc(db, 'clothingItems', item.id), JSON.parse(JSON.stringify({
    ...metadata, userId, source: 'fitlab', frontPath: photo('front'), backPath: photo('back'),
    ...(uv ? { uvFrontPath: photo('uv_front'), uvBackPath: photo('uv_back'), uvFrontIou: uv.frontIou, uvBackIou: uv.backIou,
      uvFrontFabric: uv.frontFabric, uvBackFabric: uv.backFabric } : {}),
  })));
}

export async function saveWardrobeUvMap(userId: string, id: string, uv: StoredUvMap) {
  const path = (side: string) => `users/${userId}/clothing-items/${id}_${side}`;
  await Promise.all([
    uploadBytes(ref(storage, path('uv_front')), uv.front),
    uploadBytes(ref(storage, path('uv_back')), uv.back),
  ]);
  await updateDoc(doc(db, 'clothingItems', id), {
    uvFrontPath: path('uv_front'), uvBackPath: path('uv_back'), uvFrontIou: uv.frontIou, uvBackIou: uv.backIou,
    uvFrontFabric: uv.frontFabric, uvBackFabric: uv.backFabric,
  });
}

export async function loadWardrobeItems(userId: string) {
  // A single-field query avoids requiring a newly deployed composite index.
  const snapshot = await getDocsFromServer(query(collection(db, 'clothingItems'), where('userId', '==', userId)));
  const documents = snapshot.docs.filter(d => d.data().source === 'fitlab');
  const results = await Promise.allSettled(documents.map(async d => {
    const data = d.data();
    const { source, frontPath, backPath, uvFrontPath, uvBackPath, uvFrontIou, uvBackIou, uvFrontFabric, uvBackFabric, ...metadata } = data;
    const [front, back, uvFront, uvBack] = await Promise.all([
      getBlob(ref(storage, frontPath)), getBlob(ref(storage, backPath)),
      uvFrontPath ? getBlob(ref(storage, uvFrontPath)) : Promise.resolve(null),
      uvBackPath ? getBlob(ref(storage, uvBackPath)) : Promise.resolve(null),
    ]);
    const uv: StoredUvMap | undefined = uvFront && uvBack && Array.isArray(uvFrontFabric) && Array.isArray(uvBackFabric)
      ? { front: uvFront, back: uvBack, frontIou: Number(uvFrontIou ?? 1), backIou: Number(uvBackIou ?? 1), frontFabric: uvFrontFabric as [number, number, number], backFabric: uvBackFabric as [number, number, number] }
      : undefined;
    return { ...metadata, ownerId: userId, cloudSynced: true, id: d.id, front, back, uv } as StoredItem;
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
  await Promise.allSettled(['front', 'back', 'uv_front', 'uv_back'].map(side => deleteObject(ref(storage, `users/${userId}/clothing-items/${id}_${side}`))));
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
  for (const r of remote.items) {
    const localUv = merged.get(r.id)?.uv;
    if (!r.uv && localUv) r.uv = localUv;
    merged.set(r.id, r); await storeItem(r).catch(() => undefined);
  }
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
