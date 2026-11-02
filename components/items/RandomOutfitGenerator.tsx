// components/items/RandomOutfitModal.tsx
'use client';

import { useState } from 'react';
import type { ClothingItem } from '@/lib/types/clothing';

const colors = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC'
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  items: ClothingItem[];
  availableCategories: string[];
  onGenerate: (selectedItems: ClothingItem[]) => void;
}

export default function RandomOutfitModal({ isOpen, onClose, items, availableCategories, onGenerate }: Props) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [generatedItems, setGeneratedItems] = useState<ClothingItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showExplanation, setShowExplanation] = useState(true);

  if (!isOpen) return null;

  const getCategoryCount = (category: string) => {
    return items.filter(item => item.category === category).length;
  };

  const toggleCategory = (category: string) => {
    if (selectedCategories.includes(category)) {
      setSelectedCategories(selectedCategories.filter(c => c !== category));
    } else {
      setSelectedCategories([...selectedCategories, category]);
    }
  };

  const handleGenerate = () => {
    if (selectedCategories.length === 0) return;

    setIsGenerating(true);
    setShowExplanation(false);

    setTimeout(() => {
      const randomItems: ClothingItem[] = [];

      selectedCategories.forEach(category => {
        const categoryItems = items.filter(item => item.category === category);
        if (categoryItems.length > 0) {
          const randomIndex = Math.floor(Math.random() * categoryItems.length);
          randomItems.push(categoryItems[randomIndex]);
        }
      });

      setGeneratedItems(randomItems);
      setIsGenerating(false);
    }, 800);
  };

  const handleSaveOutfit = () => {
    if (generatedItems.length > 0) {
      onGenerate(generatedItems);
      onClose();
      setGeneratedItems([]);
      setSelectedCategories([]);
      setShowExplanation(true);
    }
  };

  const handleClose = () => {
    setGeneratedItems([]);
    setSelectedCategories([]);
    setShowExplanation(true);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ borderColor: colors.peach, borderWidth: 2 }}
      >
        <div className="p-8">
          
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: colors.navy }}>
                🎲 Random Outfit Generator
              </h2>
              <p className="text-sm mt-1" style={{ color: colors.navy, opacity: 0.6 }}>
                Pick categories and generate random combinations
              </p>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:opacity-70"
              style={{ backgroundColor: colors.cream }}
            >
              <svg className="w-5 h-5" style={{ color: colors.navy }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Explanation */}
          {showExplanation && (
            <div className="mb-6 p-4 rounded-xl" style={{ backgroundColor: colors.cream }}>
              <p className="text-sm font-semibold mb-2" style={{ color: colors.navy }}>
                ✨ How it works:
              </p>
              <ul className="text-sm space-y-1" style={{ color: colors.navy, opacity: 0.8 }}>
                <li>• Select the categories you want to include</li>
                <li>• Click &ldquo;Generate Random Outfit&rdquo;</li>
                <li>• Get a random item from each category</li>
                <li>• Save it to see in your outfits</li>
              </ul>
            </div>
          )}

          {/* Category Selection */}
          <div className="mb-6">
            <p className="text-sm font-semibold mb-3" style={{ color: colors.navy }}>
              Select Categories:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {availableCategories.map((category) => {
                const count = getCategoryCount(category);
                const isSelected = selectedCategories.includes(category);
                const isDisabled = count === 0;

                return (
                  <button
                    key={category}
                    onClick={() => !isDisabled && toggleCategory(category)}
                    disabled={isDisabled}
                    className={`px-4 py-3 rounded-lg border-2 font-semibold text-sm transition-all ${
                      isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105'
                    }`}
                    style={{
                      borderColor: isSelected ? colors.navy : colors.peach,
                      backgroundColor: isSelected ? colors.pink : colors.cream,
                      color: colors.navy,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span>{category}</span>
                      <span className="text-xs ml-2 px-2 py-0.5 rounded-full" style={{ backgroundColor: 'white' }}>
                        {count}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={selectedCategories.length === 0 || isGenerating}
            className={`w-full px-6 py-4 rounded-xl font-bold text-white text-lg transition-all ${
              selectedCategories.length === 0 || isGenerating
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:scale-105 hover:shadow-lg'
            }`}
            style={{ backgroundColor: colors.navy }}
          >
            {isGenerating ? (
              <div className="flex items-center justify-center gap-3">
                <div className="w-5 h-5 border-4 border-t-transparent rounded-full animate-spin border-white"></div>
                Generating...
              </div>
            ) : (
              <>🎲 Generate Random Outfit</>
            )}
          </button>

          {/* Generated Outfit */}
          {generatedItems.length > 0 && (
            <div className="mt-6 p-4 rounded-xl" style={{ backgroundColor: colors.cream }}>
              <p className="text-sm font-bold mb-3" style={{ color: colors.navy }}>
                ✨ Your Random Outfit:
              </p>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                {generatedItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white rounded-lg overflow-hidden border-2 shadow-sm"
                    style={{ borderColor: colors.peach }}
                  >
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full aspect-square object-cover" crossOrigin="anonymous" />
                    ) : (
                      <div className="w-full aspect-square flex items-center justify-center" style={{ backgroundColor: colors.peach }}>
                        <svg className="w-12 h-12" style={{ color: colors.navy, opacity: 0.3 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                        </svg>
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-xs font-bold truncate" style={{ color: colors.navy }}>
                        {item.name}
                      </p>
                      <p className="text-xs truncate" style={{ color: colors.navy, opacity: 0.6 }}>
                        {item.brand}
                      </p>
                      <p className="text-xs font-semibold mt-1" style={{ color: colors.pink }}>
                        {item.category}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleGenerate}
                  className="flex-1 px-4 py-2 rounded-lg font-semibold border-2"
                  style={{ borderColor: colors.peach, color: colors.navy }}
                >
                  🔄 Regenerate
                </button>
                <button
                  onClick={handleSaveOutfit}
                  className="flex-1 px-4 py-2 rounded-lg font-semibold text-white"
                  style={{ backgroundColor: colors.navy }}
                >
                  💾 Save Outfit
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}