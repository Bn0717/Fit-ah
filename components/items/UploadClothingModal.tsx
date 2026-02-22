// components/items/UploadClothingModal.tsx
'use client';

import { useState } from 'react';
import type { SizeChart } from '@/lib/types/clothing';

const colors = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC'
};

const DEFAULT_CATEGORIES = ['Short Sleeve Shirt'];

// TNT CO Default Size Chart
const TNT_DEFAULT_SIZE_CHART: SizeChart[] = [
  { size: 'S',   chest: 54.5, shoulder: 43, length: 71, sleeve: 22 },
  { size: 'M',   chest: 57,   shoulder: 45, length: 73, sleeve: 23.5 },
  { size: 'L',   chest: 59.5, shoulder: 47, length: 75, sleeve: 25 },
  { size: 'XL',  chest: 62,   shoulder: 49, length: 77, sleeve: 26.5 },
  { size: '2XL', chest: 64.5, shoulder: 51, length: 79, sleeve: 28 },
  { size: '3XL', chest: 67,   shoulder: 53, length: 79, sleeve: 29.5 },
  { size: '4XL', chest: 69.5, shoulder: 55, length: 79, sleeve: 29.5 },
];

const DEFAULT_BRAND    = 'TNT CO';
const DEFAULT_CATEGORY = 'Short Sleeve Shirt';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    frontPhoto: File;
    backPhoto: File;
    brand: string;
    name: string;
    category: string;
    sizeChart: SizeChart[];
    sizeChartPhoto?: File;
    userWearingSize?: string;
    price?: number;
  }) => Promise<void>;
  availableCategories: string[];
  onAddCategory?: (name: string, icon: string) => Promise<void>;
}

// Force all inputs/textareas to show navy text — applied globally in this modal
const inputStyle = { borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy };
const inputCls   = 'w-full px-4 py-3 rounded-lg border-2 focus:outline-none';

export default function UploadClothingModal({
  isOpen,
  onClose,
  onSubmit,
  availableCategories,
  onAddCategory
}: Props) {
  const [frontPhoto, setFrontPhoto] = useState<File | null>(null);
  const [frontPhotoPreview, setFrontPhotoPreview] = useState<string | null>(null);
  const [backPhoto, setBackPhoto] = useState<File | null>(null);
  const [backPhotoPreview, setBackPhotoPreview] = useState<string | null>(null);

  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [sizeChart, setSizeChart] = useState<SizeChart[]>(TNT_DEFAULT_SIZE_CHART);
  const [sizeChartMode, setSizeChartMode] = useState<'default' | 'photo' | 'manual'>('default');
  const [sizeChartPhoto, setSizeChartPhoto] = useState<File | null>(null);
  const [sizeChartPhotoPreview, setSizeChartPhotoPreview] = useState<string | null>(null);
  const [userWearingSize, setUserWearingSize] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📦');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePhotoChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    side: 'front' | 'back'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (side === 'front') {
        setFrontPhoto(file);
        setFrontPhotoPreview(reader.result as string);
      } else {
        setBackPhoto(file);
        setBackPhotoPreview(reader.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSizeChartPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSizeChartPhoto(file);
    const reader = new FileReader();
    reader.onloadend = () => setSizeChartPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSizeChange = (index: number, field: keyof SizeChart, value: string) => {
    const updated = [...sizeChart];
    if (field === 'size') {
      updated[index][field] = value;
    } else {
      (updated[index] as any)[field] = parseFloat(value) || 0;
    }
    setSizeChart(updated);
  };

  const addSizeRow = () => {
    setSizeChart([...sizeChart, { size: '', chest: 0, length: 0, shoulder: 0, sleeve: 0 }]);
  };

  const removeSizeRow = (index: number) => {
    if (sizeChart.length > 1) setSizeChart(sizeChart.filter((_, i) => i !== index));
  };

  const handleResetToDefault = () => {
    setSizeChart(TNT_DEFAULT_SIZE_CHART);
    setSizeChartMode('default');
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || !onAddCategory) return;
    await onAddCategory(newCategoryName, newCategoryIcon);
    setCategory(newCategoryName);
    setNewCategoryName('');
    setNewCategoryIcon('📦');
    setShowAddCategory(false);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!frontPhoto) { setError('Please upload the front photo of the item'); return; }
    if (!backPhoto)  { setError('Please upload the back photo of the item');  return; }
    if (!brand.trim()) { setError('Please enter the brand name'); return; }
    if (!name.trim())  { setError('Please enter the item name');  return; }
    if (!category)     { setError('Please select a category');    return; }

    const validSizes = sizeChart.filter(s => s.size && s.chest > 0 && s.length > 0 && s.shoulder > 0);
    if (validSizes.length === 0) { setError('Please fill in at least one complete size'); return; }

    setSubmitting(true);
    try {
      await onSubmit({
        frontPhoto,
        backPhoto,
        brand,
        name,
        category,
        sizeChart: validSizes,
        sizeChartPhoto: sizeChartPhoto || undefined,
        userWearingSize: userWearingSize || undefined,
        price: price ? parseFloat(price) : undefined,
      });

      // Reset
      setFrontPhoto(null); setFrontPhotoPreview(null);
      setBackPhoto(null);  setBackPhotoPreview(null);
      setBrand(DEFAULT_BRAND);
      setName('');
      setCategory(DEFAULT_CATEGORY);
      setSizeChart(TNT_DEFAULT_SIZE_CHART);
      setSizeChartMode('default');
      setSizeChartPhoto(null); setSizeChartPhotoPreview(null);
      setUserWearingSize('');
      setPrice('');
      setError(null);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to upload item');
    } finally {
      setSubmitting(false);
    }
  };

  const allCategories = [...DEFAULT_CATEGORIES, ...availableCategories.filter(c => !DEFAULT_CATEGORIES.includes(c))];

  // ---- Shared size table ----
  const SizeTable = () => (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-2 rounded-lg overflow-hidden text-sm" style={{ borderColor: colors.peach }}>
          <thead>
            <tr style={{ backgroundColor: colors.peach }}>
              {['Size', 'Chest', 'Length', 'Shoulder', 'Sleeve', ''].map(h => (
                <th key={h} className="px-3 py-2 text-xs font-bold text-left" style={{ color: colors.navy }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sizeChart.map((size, index) => (
              <tr key={index} className="border-t" style={{ borderColor: colors.peach }}>
                {(['size', 'chest', 'length', 'shoulder', 'sleeve'] as (keyof SizeChart)[]).map((field) => (
                  <td key={field} className="px-2 py-2">
                    <input
                      type={field === 'size' ? 'text' : 'number'}
                      value={(size as any)[field] || ''}
                      onChange={(e) => handleSizeChange(index, field, e.target.value)}
                      placeholder={field === 'size' ? 'S' : '0'}
                      className={`${field === 'size' ? 'w-12 text-center font-bold' : 'w-full'} px-2 py-1 rounded border text-sm`}
                      style={{ borderColor: colors.peach, backgroundColor: 'white', color: colors.navy }}
                    />
                  </td>
                ))}
                <td className="px-2 py-2">
                  {sizeChart.length > 1 && (
                    <button onClick={() => removeSizeRow(index)} className="text-red-500 hover:text-red-700 text-xs">✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={addSizeRow}
        className="w-full mt-2 px-4 py-2 rounded-lg font-semibold border-2 text-sm"
        style={{ borderColor: colors.peach, color: colors.navy }}
      >
        + Add Size
      </button>
    </div>
  );

  // ── Single photo upload row (upload box left, reference photo right) ──────
  function PhotoUploadRow({
    side,
    preview,
    onClear,
    referenceUrl,
    referenceLabel,
    referenceNote,
  }: {
    side: 'front' | 'back';
    preview: string | null;
    onClear: () => void;
    referenceUrl: string;
    referenceLabel: string;
    referenceNote: string;
  }) {
    const label = side === 'front' ? '👕 Front' : '🔄 Back';
    const emoji = side === 'front' ? '👕' : '🔄';

    return (
      <div className="flex gap-4 items-start">
        {/* Upload area */}
        <div className="flex-1">
          <p className="text-xs font-bold mb-1.5" style={{ color: colors.navy }}>
            {label} <span className="text-red-500">*</span>
          </p>
          <div
            className="border-2 border-dashed rounded-xl overflow-hidden"
            style={{ borderColor: preview ? colors.navy : colors.peach, backgroundColor: colors.cream }}
          >
            {preview ? (
              <div className="relative">
                <img src={preview} alt={`${side} preview`} className="w-full h-40 object-contain bg-white p-2" />
                <button
                  onClick={onClear}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow text-xs font-bold"
                  style={{ color: colors.navy }}
                >✕</button>
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 text-xs font-bold text-center text-white"
                  style={{ backgroundColor: 'rgba(11,25,87,0.7)' }}>
                  {label}
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center h-40 cursor-pointer hover:opacity-80">
                <span className="text-3xl mb-2">{emoji}</span>
                <p className="text-sm font-semibold" style={{ color: colors.navy }}>{label}</p>
                <p className="text-xs mt-1 opacity-60" style={{ color: colors.navy }}>Click to upload</p>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhotoChange(e, side)}
                />
              </label>
            )}
          </div>
        </div>

        {/* Reference photo */}
        <div className="w-32 flex-shrink-0">
          <p className="text-xs font-bold mb-1.5" style={{ color: colors.navy }}>
            Reference Example
          </p>
          <div
            className="rounded-xl overflow-hidden border-2 bg-white"
            style={{ borderColor: colors.peach }}
          >
            <img
              src={referenceUrl}
              alt={referenceLabel}
              className="w-full h-40 object-contain p-2"
              crossOrigin="anonymous"
            />
          </div>
          <p className="text-[9px] mt-1 text-center leading-tight text-gray-400 italic">{referenceNote}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ borderColor: colors.peach, borderWidth: 2, color: colors.navy }}
      >
        <div className="p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold" style={{ color: colors.navy }}>Add New Item</h2>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70" style={{ backgroundColor: colors.cream }}>
              <svg className="w-5 h-5" style={{ color: colors.navy }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm font-medium text-red-700">{error}</p>
            </div>
          )}

          <div className="space-y-6">

            {/* ── PHOTO UPLOADS: front on top, back below, each with reference ── */}
            <div>
              <label className="block text-sm font-semibold mb-3" style={{ color: colors.navy }}>
                Item Photos <span className="font-normal opacity-60">(front &amp; back required)</span>
              </label>
              <div className="space-y-4">
                {/* FRONT */}
                <PhotoUploadRow
                  side="front"
                  preview={frontPhotoPreview}
                  onClear={() => { setFrontPhoto(null); setFrontPhotoPreview(null); }}
                  referenceUrl="/reference/front-reference.png"
                  referenceLabel="Front reference"
                  referenceNote="The front should show the main design/logo clearly"
                />
                {/* BACK */}
                <PhotoUploadRow
                  side="back"
                  preview={backPhotoPreview}
                  onClear={() => { setBackPhoto(null); setBackPhotoPreview(null); }}
                  referenceUrl="/reference/back-reference.png"
                  referenceLabel="Back reference"
                  referenceNote="The back should show any important details like tags or unique features"
                />
              </div>
            </div>

            {/* Brand & Name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: colors.navy }}>Brand *</label>
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="e.g., TNT CO"
                  className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none"
                  style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: colors.navy }}>Item Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Classic Tee"
                  className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none"
                  style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }}
                />
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: colors.navy }}>Category *</label>
              {showAddCategory ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input type="text" value={newCategoryIcon} onChange={(e) => setNewCategoryIcon(e.target.value)} maxLength={2}
                      className="w-16 px-3 py-3 rounded-lg border-2 text-center text-xl" style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }} />
                    <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Category name"
                      className="flex-1 px-4 py-3 rounded-lg border-2" style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleAddCategory} className="flex-1 px-4 py-2 rounded-lg font-semibold text-white" style={{ backgroundColor: colors.navy }}>Add Category</button>
                    <button onClick={() => setShowAddCategory(false)} className="px-4 py-2 rounded-lg font-semibold" style={{ backgroundColor: colors.cream, color: colors.navy }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <select value={category} onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none"
                    style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }}>
                    {allCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  <button onClick={() => setShowAddCategory(true)}
                    className="w-full px-4 py-2 rounded-lg font-semibold border-2 hover:opacity-80"
                    style={{ borderColor: colors.peach, color: colors.navy }}>
                    + Add New Category
                  </button>
                </div>
              )}
            </div>

            {/* ── SIZE CHART SECTION ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold" style={{ color: colors.navy }}>Size Chart *</label>
                <div className="flex gap-2">
                  {sizeChartMode !== 'default' && (
                    <button onClick={handleResetToDefault}
                      className="text-xs font-semibold px-3 py-1 rounded-full border"
                      style={{ borderColor: colors.navy, color: colors.navy }}>
                      ↺ Reset to TNT CO Default
                    </button>
                  )}
                </div>
              </div>

              {/* Mode Tabs */}
              <div className="flex gap-2 mb-4">
                {[
                  { id: 'default', label: '⭐ TNT CO Default' },
                  { id: 'photo',   label: '📸 Upload Photo' },
                  { id: 'manual',  label: '✍️ Custom Manual' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => {
                      setSizeChartMode(id as any);
                      if (id === 'default') setSizeChart(TNT_DEFAULT_SIZE_CHART);
                    }}
                    className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      backgroundColor: sizeChartMode === id ? colors.navy : colors.cream,
                      color: sizeChartMode === id ? 'white' : colors.navy,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {sizeChartMode === 'default' && (
                <div>
                  <div className="mb-3 p-3 rounded-lg flex items-center gap-2" style={{ backgroundColor: colors.pink }}>
                    <span className="text-sm">✨</span>
                    <p className="text-xs font-semibold" style={{ color: colors.navy }}>
                      Pre-filled with TNT CO measurements. You can edit any value below.
                    </p>
                  </div>
                  <SizeTable />
                </div>
              )}

              {sizeChartMode === 'photo' && (
                <div>
                  <div className="border-2 border-dashed rounded-xl overflow-hidden mb-4" style={{ borderColor: colors.pink, backgroundColor: colors.cream }}>
                    {sizeChartPhotoPreview ? (
                      <div className="relative">
                        <img src={sizeChartPhotoPreview} alt="Size chart" className="w-full h-48 object-contain p-2" />
                        <button onClick={() => { setSizeChartPhoto(null); setSizeChartPhotoPreview(null); }}
                          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow text-xs">✕</button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center h-48 cursor-pointer">
                        <span className="text-3xl mb-2">📏</span>
                        <p className="text-sm font-medium" style={{ color: colors.navy }}>Upload size chart photo</p>
                        <input type="file" accept="image/*" className="hidden" onChange={handleSizeChartPhotoChange} />
                      </label>
                    )}
                  </div>
                  <div className="p-3 rounded-lg mb-3" style={{ backgroundColor: colors.cream }}>
                    <p className="text-xs font-semibold" style={{ color: colors.navy }}>ℹ️ Enter the measurements below to match your photo</p>
                  </div>
                  <SizeTable />
                </div>
              )}

              {sizeChartMode === 'manual' && (
                <div>
                  <div className="p-3 rounded-lg mb-3" style={{ backgroundColor: colors.cream }}>
                    <p className="text-xs font-semibold" style={{ color: colors.navy }}>✍️ Enter your own custom measurements (cm)</p>
                  </div>
                  <SizeTable />
                </div>
              )}
            </div>

            {/* User Wearing Size */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: colors.navy }}>
                Which size do you wear? <span className="font-normal opacity-60">(Optional)</span>
              </label>
              <select value={userWearingSize} onChange={(e) => setUserWearingSize(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border-2" style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }}>
                <option value="">Select your size...</option>
                {sizeChart.filter(s => s.size).map((s) => (
                  <option key={s.size} value={s.size}>{s.size}</option>
                ))}
              </select>
            </div>

            {/* Price */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: colors.navy }}>
                Price <span className="font-normal opacity-60">(Optional)</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold" style={{ color: colors.navy }}>$</span>
                <input type="number" value={price} onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00" step="0.01" min="0"
                  className="w-full pl-10 pr-4 py-3 rounded-lg border-2 focus:outline-none"
                  style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }} />
              </div>
            </div>

          </div>

          {/* Submit */}
          <div className="mt-8 flex gap-4">
            <button onClick={onClose} disabled={submitting}
              className="flex-1 px-6 py-3 rounded-lg font-semibold border-2"
              style={{ borderColor: colors.peach, color: colors.navy }}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="flex-1 px-6 py-3 rounded-lg font-semibold text-white hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: colors.navy }}>
              {submitting ? 'Adding Item...' : 'Add Item'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}