// lib/types/clothing.ts

/**
 * Size chart for a specific garment size
 */
export interface SizeChart {
  size: string;        // e.g., "S", "M", "L", "XL"
  chest: number;       // in cm
  length: number;      // in cm
  shoulder: number;    // in cm
  sleeve?: number;     // in cm (optional)
  waist?: number;      // in cm (optional)
}

/**
 * Individual clothing item
 */
export interface ClothingItem {
  id: string;
  userId: string;
  brand: string;
  name: string;
  category: string;
  // Legacy single image (kept for backwards compat)
  imageUrl?: string;
  // New: front + back images (background removed)
  frontImageUrl?: string;
  backImageUrl?: string;
  sizeChart: SizeChart[];
  sizeChartPhotoUrl?: string | null;
  userWearingSize?: string | null;
  price?: number | null;
  isFavorite: boolean;
  lastViewed?: string;
  createdAt?: any;
}

/**
 * Outfit combination (multiple items together)
 */
export interface OutfitCombination {
  id: string;
  userId: string;
  name: string;
  itemIds: string[];
  isFavorite: boolean;
  createdAt?: any;
  notes?: string;
}

/**
 * Custom category created by user
 */
export interface CustomCategory {
  id: string;
  userId: string;
  name: string;
  icon: string;
  createdAt?: any;
}

/**
 * Random outfit configuration
 */
export interface RandomOutfitConfig {
  categories: string[];
  count: number;
}