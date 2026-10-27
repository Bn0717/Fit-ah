// lib/firebase/firestore.ts
import { db } from './config';
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  query, 
  where, 
  getDocs,
  orderBy,
  limit,
  serverTimestamp 
} from 'firebase/firestore';
import type { ParametricAvatar } from '../types/avatar';
import type { ClothingItem, OutfitCombination, CustomCategory } from '../types/clothing';
import type { FitResult } from '../types/fit';

// ==================== AVATAR OPERATIONS ====================

export const saveAvatar = async (avatar: Omit<ParametricAvatar, 'createdAt' | 'updatedAt'>) => {
  try {
    const avatarRef = doc(db, 'users', avatar.userId, 'avatar', 'data');
    // merge: fields this caller does not send (e.g. skinTone, saved on its own) are kept
    await setDoc(avatarRef, {
      ...avatar,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// Only the skin tone (null = the 3D model's own skin), without touching the measurements
export const saveSkinTone = async (userId: string, skinTone: string | null) => {
  try {
    await setDoc(doc(db, 'users', userId, 'avatar', 'data'), { skinTone, updatedAt: serverTimestamp() }, { merge: true });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const getAvatar = async (userId: string): Promise<ParametricAvatar | null> => {
  try {
    const avatarRef = doc(db, 'users', userId, 'avatar', 'data');
    const avatarSnap = await getDoc(avatarRef);
    
    if (avatarSnap.exists()) {
      return avatarSnap.data() as ParametricAvatar;
    }
    return null;
  } catch (error) {
    console.error('Error getting avatar:', error);
    return null;
  }
};

export const updateAvatar = async (userId: string, updates: Partial<ParametricAvatar>) => {
  try {
    const avatarRef = doc(db, 'users', userId, 'avatar', 'data');
    await updateDoc(avatarRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// ==================== CLOTHING OPERATIONS ====================

export const saveClothingItem = async (item: Omit<ClothingItem, 'createdAt'>) => {
  try {
    const itemRef = doc(db, 'clothingItems', item.id);
    await setDoc(itemRef, {
      ...item,
      createdAt: serverTimestamp(),
    });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const getClothingItem = async (itemId: string): Promise<ClothingItem | null> => {
  try {
    const itemRef = doc(db, 'clothingItems', itemId);
    const itemSnap = await getDoc(itemRef);
    
    if (itemSnap.exists()) {
      return itemSnap.data() as ClothingItem;
    }
    return null;
  } catch (error) {
    console.error('Error getting clothing item:', error);
    return null;
  }
};

export const getUserClothingItems = async (userId: string): Promise<ClothingItem[]> => {
  try {
    const q = query(
      collection(db, 'clothingItems'), 
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as ClothingItem);
  } catch (error) {
    console.error('Error getting user clothing items:', error);
    return [];
  }
};

export const deleteClothingItem = async (itemId: string) => {
  try {
    const itemRef = doc(db, 'clothingItems', itemId);
    await deleteDoc(itemRef);
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// NEW: Toggle favorite status
export const toggleFavorite = async (itemId: string, isFavorite: boolean) => {
  try {
    const itemRef = doc(db, 'clothingItems', itemId);
    await updateDoc(itemRef, {
      isFavorite,
    });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// NEW: Update last viewed timestamp
export const updateLastViewed = async (itemId: string) => {
  try {
    const itemRef = doc(db, 'clothingItems', itemId);
    await updateDoc(itemRef, {
      lastViewed: new Date().toISOString(),
    });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const getFavoriteItems = async (userId: string): Promise<ClothingItem[]> => {
  const q = query(
    collection(db, 'clothingItems'),
    where('userId', '==', userId),
    where('isFavorite', '==', true)
    // Remove orderBy temporarily, sort client-side instead
  );
  const querySnapshot = await getDocs(q);
  const items = querySnapshot.docs.map(doc => doc.data() as ClothingItem);
  
  // Sort client-side
  return items.sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() || 0;
    const bTime = b.createdAt?.toMillis?.() || 0;
    return bTime - aTime;
  });
}

// NEW: Get recently viewed items
export const getRecentItems = async (userId: string, limitCount: number = 10): Promise<ClothingItem[]> => {
  try {
    const allItems = await getUserClothingItems(userId);
    // Sort by lastViewed, then by createdAt
    return allItems
      .sort((a, b) => {
        const aTime = a.lastViewed || a.createdAt?.toDate?.()?.toISOString() || '';
        const bTime = b.lastViewed || b.createdAt?.toDate?.()?.toISOString() || '';
        return bTime.localeCompare(aTime);
      })
      .slice(0, limitCount);
  } catch (error) {
    console.error('Error getting recent items:', error);
    return [];
  }
};

// ==================== OUTFIT COMBINATIONS ====================

export const saveOutfitCombination = async (outfit: Omit<OutfitCombination, 'createdAt'>) => {
  try {
    const outfitRef = doc(db, 'outfitCombinations', outfit.id);
    await setDoc(outfitRef, {
      ...outfit,
      createdAt: serverTimestamp(),
    });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const getUserOutfits = async (userId: string): Promise<OutfitCombination[]> => {
  try {
    const q = query(
      collection(db, 'outfitCombinations'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as OutfitCombination);
  } catch (error) {
    console.error('Error getting user outfits:', error);
    return [];
  }
};

export const deleteOutfitCombination = async (outfitId: string) => {
  try {
    const outfitRef = doc(db, 'outfitCombinations', outfitId);
    await deleteDoc(outfitRef);
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const toggleOutfitFavorite = async (outfitId: string, isFavorite: boolean) => {
  try {
    const outfitRef = doc(db, 'outfitCombinations', outfitId);
    await updateDoc(outfitRef, {
      isFavorite,
    });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// ==================== CUSTOM CATEGORIES ====================

export const saveCustomCategory = async (category: Omit<CustomCategory, 'createdAt'>) => {
  try {
    const categoryRef = doc(db, 'customCategories', category.id);
    await setDoc(categoryRef, {
      ...category,
      createdAt: serverTimestamp(),
    });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const getUserCategories = async (userId: string): Promise<CustomCategory[]> => {
  try {
    const q = query(
      collection(db, 'customCategories'),
      where('userId', '==', userId),
      orderBy('createdAt', 'asc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as CustomCategory);
  } catch (error) {
    console.error('Error getting user categories:', error);
    return [];
  }
};

export const deleteCustomCategory = async (categoryId: string) => {
  try {
    const categoryRef = doc(db, 'customCategories', categoryId);
    await deleteDoc(categoryRef);
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// ==================== FIT RESULT OPERATIONS ====================

export const saveFitResult = async (result: Omit<FitResult, 'createdAt'>) => {
  try {
    const resultRef = doc(db, 'fitResults', result.id);
    await setDoc(resultRef, {
      ...result,
      createdAt: serverTimestamp(),
    });
    return { success: true, error: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const getFitResult = async (resultId: string): Promise<FitResult | null> => {
  try {
    const resultRef = doc(db, 'fitResults', resultId);
    const resultSnap = await getDoc(resultRef);
    
    if (resultSnap.exists()) {
      return resultSnap.data() as FitResult;
    }
    return null;
  } catch (error) {
    console.error('Error getting fit result:', error);
    return null;
  }
};

export const getUserFitResults = async (userId: string): Promise<FitResult[]> => {
  try {
    const q = query(collection(db, 'fitResults'), where('userId', '==', userId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as FitResult);
  } catch (error) {
    console.error('Error getting user fit results:', error);
    return [];
  }
};

export const getItemFitResults = async (clothingItemId: string): Promise<FitResult[]> => {
  try {
    const q = query(collection(db, 'fitResults'), where('clothingItemId', '==', clothingItemId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as FitResult);
  } catch (error) {
    console.error('Error getting item fit results:', error);
    return [];
  }
};