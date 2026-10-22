'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

// User-scoped records also support built-in products without modifying shared product data.
export function useSizePreferences(userId: string | undefined) {
  const [state, setState] = useState<{ userId?: string; sizes: Record<string, string | null>; error: string | null }>({ sizes: {}, error: null });
  const currentUser = useRef(userId);
  currentUser.current = userId;
  useEffect(() => {
    setState({ userId, sizes: {}, error: null });
    if (!userId) return;
    const key = `fitlab_sizes:${userId}`;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || '{}');
      if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
        const sizes = Object.fromEntries(Object.entries(cached).filter(([, value]) => value === null || typeof value === 'string')) as Record<string, string | null>;
        setState({ userId, sizes, error: null });
      }
    } catch { /* Account data can still load when browser storage is unavailable. */ }
    return onSnapshot(collection(db, 'users', userId, 'wardrobeSizes'), snapshot => {
      const sizes: Record<string, string | null> = {};
      snapshot.docs.forEach(d => { const value = d.data().size; if (value === null || typeof value === 'string') sizes[d.id] = value; });
      // An empty cache snapshot must not erase the last known account records.
      if (snapshot.metadata.fromCache && snapshot.empty) return;
      setState({ userId, sizes, error: null });
      try { localStorage.setItem(key, JSON.stringify(sizes)); } catch { /* Optional cache. */ }
    }, () => setState(previous => previous.userId === userId ? { ...previous, error: 'Could not sync your saved sizes. Try again when connected.' } : previous));
  }, [userId]);

  const saveSize = useCallback(async (id: string, size: string | null) => {
    if (!userId || currentUser.current !== userId) throw new Error('Sign in to save your size.');
    await setDoc(doc(db, 'users', userId, 'wardrobeSizes', id), { size, updatedAt: serverTimestamp() });
    // onSnapshot updates all open views, including other devices.
  }, [userId]);
  return { sizes: state.userId === userId ? state.sizes : {}, error: state.userId === userId ? state.error : null, saveSize };
}
