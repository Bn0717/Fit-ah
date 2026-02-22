// app/items/page.tsx
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { 
  getUserClothingItems, 
  saveClothingItem, 
  deleteClothingItem,
  toggleFavorite,
  updateLastViewed,
  getFavoriteItems,
  getRecentItems,
  getUserOutfits,
  saveOutfitCombination,
  deleteOutfitCombination,
  toggleOutfitFavorite,
  getUserCategories,
  saveCustomCategory,
  deleteCustomCategory,
  getAvatar
} from '@/lib/firebase/firestore';
import { uploadClothingPhoto } from '@/lib/firebase/storage';
import UploadClothingModal from '@/components/items/UploadClothingModal';
import CreateOutfitModal from '@/components/items/CreateOutfitModal';
import type { ClothingItem, OutfitCombination, CustomCategory } from '@/lib/types/clothing';
import FitRecommendationModal from '@/components/items/FitRecommendationModal';
import ItemDetailsModal from '@/components/items/ItemDetailsModal';
import type { ParametricAvatar } from '@/lib/types/avatar';
import RandomOutfitModal from '@/components/items/RandomOutfitGenerator';
import { removeBackgroundFree } from '@/lib/utils/imageProcessing';

const C = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC',
};

// ─── Preset bottoms & shoes (same as FitRecommendationModal) ─────────────────
const PRESET_BOTTOMS = [
  { id: 'b1', label: 'Baggy Wide-Leg Jeans',      material: 'Denim',           color: 'Black',      imageUrl: '/bottoms/baggy-wide-leg-jeans-black.jpg' },
  { id: 'b2', label: 'Casual Sweatpants',          material: 'Cotton Fleece',   color: 'White',      imageUrl: '/bottoms/casual-sweatpants-white.jpg' },
  { id: 'b3', label: 'Baggy Cargo Pants',          material: 'Cotton Twill',    color: 'Olive Green',imageUrl: '/bottoms/baggy-cargo-pants-olivegreen.jpg' },
  { id: 'b4', label: 'Wide-Leg Sweatpants',        material: 'Cotton Blend',    color: 'Grey',       imageUrl: '/bottoms/wide-leg-sweatpants.jpg' },
  { id: 'b5', label: 'Pleated Wide-Leg Trousers',  material: 'Polyester Blend', color: 'Beige',      imageUrl: '/bottoms/pleated-whide-leg-trousers-beige.jpg' },
  { id: 'b6', label: 'Casual Shorts',              material: 'Cotton',          color: 'Cream',      imageUrl: '/bottoms/casual-shorts-cream.jpg' },
  { id: 'b7', label: 'Slacks',                     material: 'Wool Blend',      color: 'Black',      imageUrl: '/bottoms/slacks-black.png' },
];
const PRESET_SHOES = [
  { id: 's1', label: 'White & Light Grey Chunky Sneakers', material: 'Leather',  color: 'White / Light Grey', imageUrl: '/shoes/chunky-sneaker.png' },
  { id: 's2', label: 'Classic Low-Top Sneakers',           material: 'Leather',  color: 'Black',              imageUrl: '/shoes/classic-low-top-sneaker-white.png' },
  { id: 's3', label: 'Casual Slip-on Loafers',             material: 'Leather',  color: 'Black',              imageUrl: '/shoes/casual-slipon-loafer.png' },
  { id: 's4', label: 'Slip-on Clog',                       material: 'Rubber',   color: 'White',              imageUrl: '/shoes/slip-on-clog.png' },
  { id: 's5', label: 'Winter Boots',                       material: 'Suede',    color: 'Brown',              imageUrl: '/shoes/winter-boot.png' },
];

const DEFAULT_CATEGORIES = ['Short Sleeve Shirt', 'Shirt', 'Jacket', 'Pants', 'Hoodie', 'Shoes', 'Accessories'];

// ─── Lightbox component ───────────────────────────────────────────────────────
function PhotoLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div className="relative max-w-2xl w-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white text-3xl font-light transition-colors"
        >×</button>
        {/* ADDED bg-white and p-4 so transparent images have a nice white canvas */}
        <img
          src={src} alt={alt}
          className="w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl bg-white p-4"
          crossOrigin="anonymous"
        />
        <p className="text-center text-white text-sm mt-4 font-bold tracking-wide">{alt}</p>
      </div>
    </div>
  );
}

// ─── Preset item card ─────────────────────────────────────────────────────────
function PresetItemCard({ label, material, color, imageUrl, onPhotoClick }: {
  label: string; material: string; color: string; imageUrl: string;
  onPhotoClick: (src: string, alt: string) => void;
}) {
  return (
    <div
      className="bg-white rounded-xl border-2 overflow-hidden transition-all hover:shadow-md"
      style={{ borderColor: C.peach }}
    >
      {/* Photo */}
      <div
        className="aspect-[3/4] relative overflow-hidden cursor-zoom-in bg-white" 
        onClick={() => onPhotoClick(imageUrl, label)}
      >
        {/* Changed object-cover to object-contain with p-4 so the shoes fit nicely without being cut off */}
        <img 
          src={imageUrl} 
          alt={label} 
          className="w-full h-full object-contain p-4 transition-transform hover:scale-105" 
          crossOrigin="anonymous" 
        />
        
        {/* Zoom hint */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
          style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}>
          <span className="text-white text-2xl">🔍</span>
        </div>
        {/* Preset badge */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest"
          style={{ backgroundColor: C.navy, color: 'white' }}>
          Preset
        </div>
      </div>
      {/* Info */}
      <div className="p-3">
        <h3 className="font-bold text-sm truncate mb-1" style={{ color: C.navy }}>{label}</h3>
        <p className="text-[10px] text-gray-400">
          <span className="font-semibold" style={{ color: C.navy, opacity: 0.6 }}>{material}</span>
          <span className="mx-1">·</span>
          <span>{color}</span>
        </p>
        <p className="mt-2 text-[9px] leading-snug text-gray-400 italic">
          Preset item — available for AI outfit suggestions
        </p>
      </div>
    </div>
  );
}

export default function ItemsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'items' | 'favorites' | 'recent' | 'outfits'>('items');
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [outfits, setOutfits] = useState<OutfitCombination[]>([]);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showOutfitModal, setShowOutfitModal] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [filterBrand, setFilterBrand] = useState('All Items');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📦');
  const [showItemDetails, setShowItemDetails] = useState(false);
  const [showFitModal, setShowFitModal] = useState(false);
  const [selectedItemForDetails, setSelectedItemForDetails] = useState<ClothingItem | null>(null);
  const [userProfile, setUserProfile] = useState<ParametricAvatar | null>(null);
  const [showRandomModal, setShowRandomModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [processingItems, setProcessingItems] = useState<any[]>([]);
  // Lightbox state
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [user, authLoading, router]);

  useEffect(() => { if (user) loadData(); }, [user, activeTab]);
  useEffect(() => { if (user) loadUserProfile(); }, [user]);

  const loadUserProfile = async () => {
    if (!user) return;
    try { setUserProfile(await getAvatar(user.uid)); } catch {}
  };

  const loadData = async () => {
    if (!user) return;
    setLoading(true); setError(null);
    try {
      if (activeTab === 'items')         setItems(await getUserClothingItems(user.uid));
      else if (activeTab === 'favorites') setItems(await getFavoriteItems(user.uid));
      else if (activeTab === 'recent')    setItems(await getRecentItems(user.uid));
      else if (activeTab === 'outfits') {
        setOutfits(await getUserOutfits(user.uid));
        setItems(await getUserClothingItems(user.uid));
      }
      setCustomCategories(await getUserCategories(user.uid));
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleUpload = async (data: {
    frontPhoto: File; backPhoto: File; brand: string; name: string;
    category: string; sizeChart: any[]; sizeChartPhoto?: File;
    userWearingSize?: string; price?: number;
  }) => {
    if (!user) return;
    const tempId = `temp_${Date.now()}`;
    setProcessingItems(prev => [{ id: tempId, name: data.name, brand: data.brand, imageUrl: URL.createObjectURL(data.frontPhoto) }, ...prev]);

    const runBg = async () => {
      try {
        const [frontBlob, backBlob] = await Promise.all([
          removeBackgroundFree(data.frontPhoto), removeBackgroundFree(data.backPhoto),
        ]);
        const toFile = (blob: Blob | null, orig: File, suf: string) => {
          if (!blob) return orig;
          return new File([blob], `${orig.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${suf}.png`, { type: 'image/png' });
        };
        const itemId = `item_${Date.now()}`;
        const [{ url: frontUrl }, { url: backUrl }] = await Promise.all([
          uploadClothingPhoto(user.uid, itemId, toFile(frontBlob, data.frontPhoto, 'front'), 'clothing-items/front'),
          uploadClothingPhoto(user.uid, itemId, toFile(backBlob, data.backPhoto, 'back'), 'clothing-items/back'),
        ]);
        await saveClothingItem({
          id: itemId, userId: user.uid, brand: data.brand, name: data.name,
          category: data.category, imageUrl: frontUrl || '', frontImageUrl: frontUrl || '',
          backImageUrl: backUrl || '', sizeChart: data.sizeChart, isFavorite: false,
          price: data.price || null, sizeChartPhotoUrl: null,
          userWearingSize: data.userWearingSize || null,
        });
        setProcessingItems(prev => prev.filter(i => i.id !== tempId));
        await loadData();
      } catch { setProcessingItems(prev => prev.filter(i => i.id !== tempId)); }
    };
    runBg();
    return new Promise<void>(resolve => setTimeout(() => { setSuccessMessage('Adding to wardrobe...'); resolve(); }, 3000));
  };

  const handleDelete = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    const { success, error: e } = await deleteClothingItem(itemId);
    if (success) await loadData(); else setError(e || 'Failed to delete item');
  };

  const handleToggleFavorite = async (itemId: string, cur: boolean) => {
    const { success } = await toggleFavorite(itemId, !cur);
    if (success) await loadData();
  };

  const handleDeleteOutfit = async (outfitId: string) => {
    if (!confirm('Are you sure you want to delete this outfit?')) return;
    const { success, error: e } = await deleteOutfitCombination(outfitId);
    if (success) await loadData(); else setError(e || 'Failed to delete outfit');
  };

  const handleItemClick = async (itemId: string) => {
    setSelectedItem(itemId);
    const item = items.find(i => i.id === itemId);
    if (item) { setSelectedItemForDetails(item); setShowItemDetails(true); }
    await updateLastViewed(itemId);
  };

  const handleCreateOutfit = async (data: { name: string; itemIds: string[]; notes?: string }) => {
    if (!user) return;
    const outfitId = `outfit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const { success, error: e } = await saveOutfitCombination({
      id: outfitId, userId: user.uid, name: data.name,
      itemIds: data.itemIds, notes: data.notes, isFavorite: false,
    });
    if (!success || e) throw new Error(e || 'Failed to create outfit');
    await loadData();
  };

  const handleRandomOutfit = async (selectedItems: ClothingItem[]) => {
    if (!user || !selectedItems.length) return;
    try {
      const { success, error: e } = await saveOutfitCombination({
        id: `outfit_${Date.now()}`, userId: user.uid,
        name: `Random Outfit ${new Date().toLocaleDateString()}`,
        itemIds: selectedItems.map(i => i.id), isFavorite: false, notes: 'Generated randomly',
      });
      if (!success) throw new Error(e || 'Failed to save');
      await loadData();
      setSuccessMessage('Random outfit saved!');
      setTimeout(() => setSuccessMessage(null), 2000);
      setActiveTab('outfits'); setShowRandomModal(false);
    } catch (err: any) { setError(err.message); }
  };

  const handleToggleOutfitFavorite = async (outfitId: string, cur: boolean) => {
    const { success } = await toggleOutfitFavorite(outfitId, !cur);
    if (success) await loadData();
  };

  const handleAddCategory = async () => {
    if (!user || !newCategoryName.trim()) return;
    const categoryId = `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const { success } = await saveCustomCategory({ id: categoryId, userId: user.uid, name: newCategoryName.trim(), icon: newCategoryIcon });
    if (success) { setNewCategoryName(''); setNewCategoryIcon('📦'); setShowAddCategory(false); await loadData(); }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm('Delete this category? Items using it will not be deleted.')) return;
    const { success } = await deleteCustomCategory(categoryId);
    if (success) await loadData();
  };

  const allCategories = [...DEFAULT_CATEGORIES, ...customCategories.map(c => c.name)];
  const brands = ['All Items', ...Array.from(new Set(items.map(i => i.brand)))];

  let filteredItems = items;
  if (filterBrand !== 'All Items') filteredItems = filteredItems.filter(i => i.brand === filterBrand);
  if (filterCategory) filteredItems = filteredItems.filter(i => i.category === filterCategory);
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredItems = filteredItems.filter(i =>
      i.name.toLowerCase().includes(q) || i.brand.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)
    );
  }

  const categoryCounts: Record<string, number> = {};
  allCategories.forEach(cat => { categoryCounts[cat] = items.filter(i => i.category === cat).length; });

  // Preset counts for category badges
  categoryCounts['Pants'] = (categoryCounts['Pants'] || 0) + PRESET_BOTTOMS.length;
  categoryCounts['Shoes'] = (categoryCounts['Shoes'] || 0) + PRESET_SHOES.length;

  const catIcon = (cat: string, custom?: CustomCategory) => custom?.icon || (
    cat === 'Short Sleeve Shirt' ? '👔' : cat === 'Shirt' ? '👕' : cat === 'Jacket' ? '🧥' :
    cat === 'Pants' ? '👖' : cat === 'Hoodie' ? '🧥' : cat === 'Shoes' ? '👟' :
    cat === 'Accessories' ? '👜' : '📦'
  );

  // Decide whether to show preset items in addition to user items
  const showPresetBottoms = filterCategory === 'Pants' || (!filterCategory && activeTab === 'items' && !filterBrand.includes(' '));
  const showPresetShoes   = filterCategory === 'Shoes'  || (!filterCategory && activeTab === 'items' && !filterBrand.includes(' '));

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.cream }}>
        <div className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: C.cream }}>

      {/* ═══ LEFT SIDEBAR ════════════════════════════════════════════════════ */}
      <div className="w-96 border-r overflow-y-auto" style={{ backgroundColor: 'white', borderColor: C.peach }}>
        <div className="p-6">

          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-1" style={{ color: C.navy }}>MY WARDROBE</h1>
            <p className="text-sm" style={{ color: C.navy, opacity: 0.6 }}>Manage your clothing collection</p>
          </div>

          {/* Search */}
          <div className="mb-6 relative">
            <input
              type="text" placeholder="Search items..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 pl-10 rounded-lg border-2 focus:outline-none"
              style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }}
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: C.navy, opacity: 0.5 }}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          {/* Action buttons */}
          <div className="space-y-3 mb-6">
            <button onClick={() => setShowUpload(true)}
              className="w-full px-4 py-3 rounded-lg font-medium text-sm transition-all hover:opacity-90 flex items-center justify-center gap-2"
              style={{ backgroundColor: C.navy, color: 'white' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add New Item
            </button>
            <button onClick={() => setShowOutfitModal(true)}
              className="w-full px-4 py-3 rounded-lg font-medium text-sm transition-all hover:opacity-90 flex items-center justify-center gap-2"
              style={{ backgroundColor: C.pink, color: C.navy }}>
              <span>✨</span> Create Outfit Combo
            </button>
          </div>

          <div className="mb-6 border-t" style={{ borderColor: C.peach }} />

          {/* Brand filter */}
          <div className="mb-6">
            <label className="block text-xs font-semibold mb-3" style={{ color: C.navy, opacity: 0.6 }}>
              FILTER BY BRAND
            </label>
            <div className="space-y-2">
              {brands.map(brand => (
                <button key={brand} onClick={() => setFilterBrand(brand)}
                  className="w-full px-4 py-2 rounded-lg text-left font-medium text-sm transition-all hover:opacity-90"
                  style={{ backgroundColor: brand === filterBrand ? C.peach : C.cream, color: C.navy }}>
                  {brand}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6 border-t" style={{ borderColor: C.peach }} />

          {/* Category filter */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold" style={{ color: C.navy, opacity: 0.6 }}>CATEGORIES</label>
              <button onClick={() => setShowAddCategory(!showAddCategory)}
                className="text-xs font-bold hover:underline" style={{ color: C.navy }}>+ Add</button>
            </div>

            {showAddCategory && (
              <div className="mb-3 p-3 rounded-lg" style={{ backgroundColor: C.cream }}>
                <div className="flex gap-2 mb-2">
                  <input type="text" placeholder="Emoji" value={newCategoryIcon}
                    onChange={e => setNewCategoryIcon(e.target.value)} maxLength={2}
                    className="w-12 px-2 py-1 rounded border text-center text-sm" style={{ borderColor: C.peach }} />
                  <input type="text" placeholder="Category name" value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    className="flex-1 px-3 py-1 rounded border text-sm" style={{ borderColor: C.peach }} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setShowAddCategory(false); setNewCategoryName(''); setNewCategoryIcon('📦'); }}
                    className="flex-1 px-3 py-1 rounded text-xs font-medium" style={{ backgroundColor: 'white', color: C.navy }}>
                    Cancel
                  </button>
                  <button onClick={handleAddCategory}
                    className="flex-1 px-3 py-1 rounded text-xs font-bold text-white" style={{ backgroundColor: C.navy }}>
                    Add
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {allCategories.map(cat => {
                const customCat = customCategories.find(c => c.name === cat);
                return (
                  <button key={cat}
                    onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                    className="w-full px-4 py-2 rounded-lg text-left font-medium text-sm transition-all hover:opacity-90 flex items-center justify-between group"
                    style={{ backgroundColor: filterCategory === cat ? C.pink : C.cream, color: C.navy }}>
                    <span className="flex items-center gap-2">
                      <span>{catIcon(cat, customCat)}</span>
                      <span>{cat}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: filterCategory === cat ? C.cream : C.pink, color: C.navy }}>
                        {categoryCounts[cat] || 0}
                      </span>
                      {customCat && (
                        <div onClick={e => { e.stopPropagation(); handleDeleteCategory(customCat.id); }}
                          className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 text-xs cursor-pointer">✕</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          <div className="p-4 rounded-lg" style={{ backgroundColor: C.pink }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold" style={{ color: C.navy }}>Total Items</span>
              <span className="text-xs font-bold" style={{ color: C.navy }}>{items.length} items</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: C.navy }}>Outfit Combos</span>
              <span className="text-xs font-bold" style={{ color: C.navy }}>{outfits.length} outfits</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ RIGHT CONTENT ═══════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: C.cream }}>
        <div className="p-8">

          {/* Random outfit button */}
          <div className="mb-6">
            <button onClick={() => setShowRandomModal(true)}
              className="px-6 py-3 rounded-xl font-semibold text-white flex items-center gap-2 shadow-sm hover:opacity-90 transition-all hover:shadow-md"
              style={{ backgroundColor: C.navy }}>
              <span className="text-xl">🎲</span>
              Random Outfit Generator
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-8 border-b" style={{ borderColor: C.peach }}>
            {([
              { id: 'items',     label: `All Items (${items.length})` },
              { id: 'favorites', label: `Favourite (${items.filter(i => i.isFavorite).length})` },
              { id: 'recent',    label: 'Recent' },
              { id: 'outfits',   label: `Outfits (${outfits.length})` },
            ] as const).map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="px-6 py-3 font-semibold transition-colors relative"
                style={{ color: C.navy, opacity: activeTab === tab.id ? 1 : 0.5 }}>
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: C.navy }} />
                )}
              </button>
            ))}
          </div>

          {/* Toast */}
          {successMessage && (
            <div className="fixed bottom-8 right-8 bg-green-500 text-white px-6 py-3 rounded-xl shadow-lg z-50 font-semibold">
              {successMessage}
            </div>
          )}
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm font-medium text-red-700">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 mx-auto mb-4 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
              <p className="font-medium" style={{ color: C.navy }}>Loading...</p>
            </div>

          ) : activeTab === 'outfits' ? (
            /* ── OUTFITS VIEW ── */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {outfits.map(outfit => {
                const outfitItems = items.filter(i => outfit.itemIds.includes(i.id));
                return (
                  <div key={outfit.id}
                    className="bg-white rounded-xl shadow-sm border-2 transition-all hover:shadow-md overflow-hidden group"
                    style={{ borderColor: C.peach }}>
                    <div className="grid grid-cols-2 gap-1 p-2" style={{ backgroundColor: C.cream }}>
                      {outfitItems.slice(0, 4).map((item, idx) => (
                        <div key={idx} className="aspect-square rounded-lg overflow-hidden" style={{ backgroundColor: C.peach }}>
                          {item.imageUrl
                            ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" crossOrigin="anonymous" />
                            : <div className="w-full h-full flex items-center justify-center text-2xl">👕</div>}
                        </div>
                      ))}
                      {outfitItems.length < 4 && [...Array(4 - outfitItems.length)].map((_, i) => (
                        <div key={`e${i}`} className="aspect-square rounded-lg opacity-30" style={{ backgroundColor: C.peach }} />
                      ))}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-bold text-lg" style={{ color: C.navy }}>{outfit.name}</h3>
                        <button onClick={() => handleToggleOutfitFavorite(outfit.id, outfit.isFavorite)}
                          className="text-xl transition-transform hover:scale-110">
                          {outfit.isFavorite ? '⭐' : '☆'}
                        </button>
                      </div>
                      <p className="text-sm mb-2" style={{ color: C.navy, opacity: 0.7 }}>{outfitItems.length} items</p>
                      {outfit.notes && (
                        <p className="text-xs mb-3 p-2 rounded" style={{ backgroundColor: C.cream, color: C.navy }}>{outfit.notes}</p>
                      )}
                      <button onClick={() => handleDeleteOutfit(outfit.id)}
                        className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                        style={{ backgroundColor: C.peach, color: C.navy }}>Delete Outfit</button>
                    </div>
                  </div>
                );
              })}
              <div onClick={() => setShowOutfitModal(true)}
                className="bg-white rounded-xl border-2 border-dashed cursor-pointer hover:shadow-md flex items-center justify-center p-12 transition-all"
                style={{ borderColor: C.pink, minHeight: '320px' }}>
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: C.peach }}>
                    <svg className="w-8 h-8" style={{ color: C.navy }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium" style={{ color: C.navy }}>Create New Outfit</p>
                </div>
              </div>
            </div>

          ) : (
            /* ── ITEMS GRID ── */
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">

                {/* Ghost / processing items */}
                {processingItems.map(item => (
                  <div key={item.id} className="bg-white rounded-xl border-2 border-dashed border-blue-200 overflow-hidden">
                    <div className="aspect-[3/4] relative bg-gray-50 flex items-center justify-center">
                      <img src={item.imageUrl} alt="" className="w-full h-full object-cover blur-sm opacity-40" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest text-center">Processing...</p>
                      </div>
                    </div>
                    <div className="p-4 bg-white">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">{item.brand}</p>
                      <h3 className="font-semibold text-gray-300 truncate">{item.name}</h3>
                    </div>
                  </div>
                ))}

                {/* User clothing items */}
                {filteredItems.map(item => (
                  <div key={item.id} onClick={() => handleItemClick(item.id)}
                    className="bg-white rounded-xl border-2 transition-all cursor-pointer overflow-hidden hover:shadow-md relative group"
                    style={{ borderColor: selectedItem === item.id ? C.navy : C.peach }}>

                    {/* Action buttons on hover */}
                    <div className="absolute top-2 right-2 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); handleToggleFavorite(item.id, item.isFavorite); }}
                        className="w-8 h-8 rounded-full flex items-center justify-center bg-white text-lg transition-transform hover:scale-110">
                        {item.isFavorite ? '⭐' : '☆'}
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(item.id); }}
                        className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors">
                        ✕
                      </button>
                    </div>

                    {/* Photo — Clicking this now correctly bubbles up to handleItemClick to open Details Modal */}
                    <div className="aspect-[3/4] relative overflow-hidden bg-white">
                      {item.imageUrl
                        ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" crossOrigin="anonymous" />
                        : <div className="w-full h-full flex items-center justify-center text-4xl opacity-20">👕</div>}
                      
                      {/* Hover overlay hint that it opens details */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                        <span className="bg-white/80 text-xs font-bold px-3 py-1.5 rounded-full" style={{ color: C.navy, backdropFilter: 'blur(4px)' }}>
                          View Details
                        </span>
                      </div>
                    </div>

                    <div className="p-4 bg-white">
                      <span className="inline-block px-3 py-1 rounded-full text-xs font-bold mb-2"
                        style={{ backgroundColor: C.pink, color: C.navy }}>{item.brand}</span>
                      {/* Name + price */}
                      <div className="flex items-center justify-between gap-1 mb-1">
                        {/* Show Name and the specific Size they uploaded */}
                        <h3 className="font-semibold truncate" style={{ color: C.navy }}>
                          {item.name} {item.userWearingSize ? <span className="text-gray-400 font-normal">({item.userWearingSize})</span> : ''}
                        </h3>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(item as any).price && (
                          <span className="flex-shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: C.peach, color: C.navy }}>
                            RM {Number((item as any).price).toFixed(0)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs" style={{ color: C.navy, opacity: 0.5 }}>
                        {item.category} · {item.sizeChart.length} sizes
                      </p>
                    </div>
                  </div>
                ))}

                {/* ── PRESET BOTTOMS (Pants category or All Items) ── */}
                {(filterCategory === 'Pants' || (!filterCategory && activeTab !== 'favorites' && activeTab !== 'recent')) &&
                  PRESET_BOTTOMS.map(b => (
                    <PresetItemCard key={b.id} label={b.label} material={b.material} color={b.color}
                      imageUrl={b.imageUrl} onPhotoClick={(src, alt) => setLightbox({ src, alt })} />
                  ))
                }

                {/* ── PRESET SHOES ── */}
                {(filterCategory === 'Shoes' || (!filterCategory && activeTab !== 'favorites' && activeTab !== 'recent')) &&
                  PRESET_SHOES.map(s => (
                    <PresetItemCard key={s.id} label={s.label} material={s.material} color={s.color}
                      imageUrl={s.imageUrl} onPhotoClick={(src, alt) => setLightbox({ src, alt })} />
                  ))
                }
              </div>

              {filteredItems.length === 0 && processingItems.length === 0 && !loading && (
                <div className="text-center py-12">
                  <h3 className="text-xl font-bold mb-2" style={{ color: C.navy }}>
                    {searchQuery ? 'No items found' : 'No items yet'}
                  </h3>
                  <p className="text-sm mb-4" style={{ color: C.navy, opacity: 0.6 }}>
                    {searchQuery ? `No items match "${searchQuery}"` :
                     activeTab === 'favorites' ? 'Star items to add them to favorites' :
                     activeTab === 'recent'    ? 'Recently viewed items will appear here' :
                     'Add your first clothing item to get started'}
                  </p>
                  {!searchQuery && activeTab === 'items' && (
                    <button onClick={() => setShowUpload(true)}
                      className="px-6 py-3 rounded-lg font-semibold text-white hover:opacity-90"
                      style={{ backgroundColor: C.navy }}>Add Item</button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── MODALS ────────────────────────────────────────────────────────── */}
      <UploadClothingModal
        isOpen={showUpload} onClose={() => setShowUpload(false)} onSubmit={handleUpload}
        availableCategories={customCategories.map(c => c.name)}
        onAddCategory={async (name, icon) => {
          await saveCustomCategory({ id: `cat_${Date.now()}`, userId: user.uid, name, icon });
          await loadData();
        }}
      />
      <CreateOutfitModal isOpen={showOutfitModal} onClose={() => setShowOutfitModal(false)}
        availableItems={items} onSubmit={handleCreateOutfit} />
      <RandomOutfitModal isOpen={showRandomModal} onClose={() => setShowRandomModal(false)}
        items={items} availableCategories={allCategories} onGenerate={handleRandomOutfit} />

      {selectedItemForDetails && (
        <>
          <ItemDetailsModal isOpen={showItemDetails} onClose={() => setShowItemDetails(false)}
            item={selectedItemForDetails}
            onCheckFit={() => { setShowItemDetails(false); setShowFitModal(true); }} />
          <FitRecommendationModal isOpen={showFitModal} onClose={() => setShowFitModal(false)}
            item={selectedItemForDetails} userProfile={userProfile} />
        </>
      )}

      {/* Lightbox */}
      {lightbox && (
        <PhotoLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}