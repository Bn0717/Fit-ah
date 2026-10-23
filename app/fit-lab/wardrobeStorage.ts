import { auth } from '@/lib/firebase/config';
import type { SizeChartData } from './WardrobeExtras';
// ─── browser storage for added items (photos are re-aligned on load) ───────────────
export interface StoredUvMap { front: Blob; back: Blob; frontIou: number; backIou: number; frontFabric: [number, number, number]; backFabric: [number, number, number] }
export interface StoredItem { id: string; ownerId?: string; cloudSynced?: boolean; brand: string; name: string; front: Blob; back: Blob; uv?: StoredUvMap; created: number; kind?: 'shirt' | 'pants'; chart?: SizeChartData; chartMode?: string }
const openDb = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('fitlab', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await openDb();
  return new Promise<T>((res, rej) => {
    const transaction = db.transaction('items', mode);
    const request = f(transaction.objectStore('items'));
    transaction.oncomplete = () => { db.close(); res(request.result); };
    transaction.onabort = transaction.onerror = () => { db.close(); rej(transaction.error ?? request.error ?? new Error('Wardrobe storage failed.')); };
  });
};
export const storeItem = (it: StoredItem) => tx('readwrite', s => s.put(it));
export const unstoreItem = (id: string) => tx('readwrite', s => s.delete(id));
export const loadStored = async (userId = auth.currentUser?.uid) => {
  if (!userId) return [];
  const records = await tx<StoredItem[]>('readonly', s => s.getAll() as IDBRequest<StoredItem[]>);
  // Legacy browser-only clothes had no owner. Claim once, preserving the existing wardrobe.
  const own = records.filter(item => !item.ownerId || item.ownerId === userId);
  for (const item of own) if (!item.ownerId) { item.ownerId = userId; await storeItem(item); }
  return own;
};
