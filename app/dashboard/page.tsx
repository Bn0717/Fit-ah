// app/dashboard/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getUserClothingItems, getAvatar } from '@/lib/firebase/firestore';
import { DashboardCardSkeleton } from '@/components/ui/Skeleton';
import type { ClothingItem } from '@/lib/types/clothing';
import type { ParametricAvatar } from '@/lib/types/avatar';

const colors = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC'
};

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [profile, setProfile] = useState<ParametricAvatar | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const [userItems, userProfile] = await Promise.all([
        getUserClothingItems(user.uid),
        getAvatar(user.uid)
      ]);
      setItems(userItems);
      setProfile(userProfile);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate stats
  const totalItems = items.length;
  const favoriteItems = items.filter(i => i.isFavorite).length;
  
  // Brand stats
  const brandCounts: Record<string, number> = {};
  items.forEach(item => {
    brandCounts[item.brand] = (brandCounts[item.brand] || 0) + 1;
  });
  const topBrand = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0];
  
  // Category stats
  const categoryCounts: Record<string, number> = {};
  items.forEach(item => {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  });
  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
  
  // Size distribution by brand
  const sizesByBrand: Record<string, Set<string>> = {};
  items.forEach(item => {
    if (!sizesByBrand[item.brand]) {
      sizesByBrand[item.brand] = new Set();
    }
    item.sizeChart.forEach(size => sizesByBrand[item.brand].add(size.size));
  });
  
  // Calculate total money spent on all items
  const totalMoneySpent = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: colors.cream }}>
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: colors.navy, borderTopColor: 'transparent' }}></div>
          <p className="font-semibold" style={{ color: colors.navy }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: colors.cream }}>
      <div className="max-w-7xl mx-auto p-8">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: colors.navy }}>
            Dashboard
          </h1>
          <p className="text-lg" style={{ color: colors.navy, opacity: 0.7 }}>
            Your wardrobe insights and recommendations
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <DashboardCardSkeleton />
            <DashboardCardSkeleton />
            <DashboardCardSkeleton />
            <DashboardCardSkeleton />
          </div>
        ) : (
          <>
            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              
              <div className="bg-white rounded-xl p-6 shadow-sm border-2 transition-all hover:shadow-md" style={{ borderColor: colors.peach }}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-semibold" style={{ color: colors.navy, opacity: 0.6 }}>
                    TOTAL ITEMS
                  </span>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.peach }}>
                    <span className="text-xl">👔</span>
                  </div>
                </div>
                <p className="text-4xl font-bold mb-1" style={{ color: colors.navy }}>
                  {totalItems}
                </p>
                <p className="text-xs" style={{ color: colors.navy, opacity: 0.5 }}>
                  {favoriteItems} favorites
                </p>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-sm border-2 transition-all hover:shadow-md" style={{ borderColor: colors.pink }}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-semibold" style={{ color: colors.navy, opacity: 0.6 }}>
                    TOP BRAND
                  </span>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.pink }}>
                    <span className="text-xl">⭐</span>
                  </div>
                </div>
                <p className="text-2xl font-bold mb-1 truncate" style={{ color: colors.navy }}>
                  {topBrand ? topBrand[0] : '-'}
                </p>
                <p className="text-xs" style={{ color: colors.navy, opacity: 0.5 }}>
                  {topBrand ? `${topBrand[1]} items` : 'Add items to see stats'}
                </p>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-sm border-2 transition-all hover:shadow-md" style={{ borderColor: colors.peach }}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-semibold" style={{ color: colors.navy, opacity: 0.6 }}>
                    MOST WORN
                  </span>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.peach }}>
                    <span className="text-xl">
                      {topCategory?.[0] === 'Shirt' ? '👕' : 
                       topCategory?.[0] === 'Jacket' ? '🧥' :
                       topCategory?.[0] === 'Pants' ? '👖' : '📦'}
                    </span>
                  </div>
                </div>
                <p className="text-2xl font-bold mb-1" style={{ color: colors.navy }}>
                  {topCategory ? topCategory[0] : '-'}
                </p>
                <p className="text-xs" style={{ color: colors.navy, opacity: 0.5 }}>
                  {topCategory ? `${topCategory[1]} items` : 'Add items to see stats'}
                </p>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-sm border-2 transition-all hover:shadow-md" style={{ borderColor: colors.pink }}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-semibold" style={{ color: colors.navy, opacity: 0.6 }}>
                    TOTAL MONEY SPENT
                  </span>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.pink }}>
                    <span className="text-xl">💰</span>
                  </div>
                </div>
                <p className="text-3xl font-bold mb-1" style={{ color: colors.navy }}>
                  RM {totalMoneySpent.toFixed(2)}
                </p>
                <p className="text-xs" style={{ color: colors.navy, opacity: 0.5 }}>
                  All your wardrobe items
                </p>
              </div>

            </div>

            {/* Size Insights */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              
              {/* Size Variability */}
              <div className="bg-white rounded-xl p-6 shadow-sm border-2" style={{ borderColor: colors.peach }}>
                <h3 className="text-xl font-bold mb-4" style={{ color: colors.navy }}>
                  📊 Size Varies by Brand
                </h3>
                
                {Object.keys(sizesByBrand).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(sizesByBrand).slice(0, 5).map(([brand, sizes]) => (
                      <div key={brand}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-sm" style={{ color: colors.navy }}>
                            {brand}
                          </span>
                          <span className="text-xs px-2 py-1 rounded-full font-bold" style={{ backgroundColor: colors.pink, color: colors.navy }}>
                            {Array.from(sizes).join(', ')}
                          </span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: colors.cream }}>
                          <div 
                            className="h-full rounded-full"
                            style={{ 
                              width: `${(brandCounts[brand] / totalItems) * 100}%`,
                              backgroundColor: colors.navy
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm" style={{ color: colors.navy, opacity: 0.6 }}>
                      Add more items to see size insights
                    </p>
                  </div>
                )}
              </div>

              {/* Profile Status */}
              <div className="bg-white rounded-xl p-6 shadow-sm border-2" style={{ borderColor: colors.pink }}>
                <h3 className="text-xl font-bold mb-4" style={{ color: colors.navy }}>
                  👤 Your Profile
                </h3>
                
                {profile ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg" style={{ backgroundColor: colors.cream }}>
                        <p className="text-xs font-semibold mb-1" style={{ color: colors.navy, opacity: 0.6 }}>
                          Height
                        </p>
                        <p className="text-xl font-bold" style={{ color: colors.navy }}>
                          {profile.height} cm
                        </p>
                      </div>
                      <div className="p-3 rounded-lg" style={{ backgroundColor: colors.cream }}>
                        <p className="text-xs font-semibold mb-1" style={{ color: colors.navy, opacity: 0.6 }}>
                          Chest
                        </p>
                        <p className="text-xl font-bold" style={{ color: colors.navy }}>
                          {profile.chest} cm
                        </p>
                      </div>
                      <div className="p-3 rounded-lg" style={{ backgroundColor: colors.cream }}>
                        <p className="text-xs font-semibold mb-1" style={{ color: colors.navy, opacity: 0.6 }}>
                          Waist
                        </p>
                        <p className="text-xl font-bold" style={{ color: colors.navy }}>
                          {profile.waist} cm
                        </p>
                      </div>
                      <div className="p-3 rounded-lg" style={{ backgroundColor: colors.cream }}>
                        <p className="text-xs font-semibold mb-1" style={{ color: colors.navy, opacity: 0.6 }}>
                          Shoulder
                        </p>
                        <p className="text-xl font-bold" style={{ color: colors.navy }}>
                          {profile.shoulder} cm
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => router.push('/profile')}
                      className="w-full px-4 py-2 rounded-lg font-medium text-sm transition-all hover:opacity-90"
                      style={{ backgroundColor: colors.peach, color: colors.navy }}
                    >
                      Update Measurements
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm mb-4" style={{ color: colors.navy, opacity: 0.6 }}>
                      Complete your profile to get personalized fit recommendations
                    </p>
                    <button
                      onClick={() => router.push('/profile')}
                      className="px-6 py-3 rounded-lg font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: colors.navy }}
                    >
                      Set Up Profile
                    </button>
                  </div>
                )}
              </div>

            </div>

            {/* Recommendations */}
            <div className="bg-white rounded-xl p-6 shadow-sm border-2" style={{ borderColor: colors.peach }}>
              <h3 className="text-xl font-bold mb-4" style={{ color: colors.navy }}>
                💡 Recommendations for You
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg" style={{ backgroundColor: colors.cream }}>
                  <p className="text-2xl mb-2">🎯</p>
                  <p className="font-semibold mb-1 text-sm" style={{ color: colors.navy }}>
                    Stay Consistent
                  </p>
                  <p className="text-xs" style={{ color: colors.navy, opacity: 0.7 }}>
                    You prefer {topBrand?.[0] || 'certain brands'}. Try their new collections for similar fits!
                  </p>
                </div>

                <div className="p-4 rounded-lg" style={{ backgroundColor: colors.cream }}>
                  <p className="text-2xl mb-2">📸</p>
                  <p className="font-semibold mb-1 text-sm" style={{ color: colors.navy }}>
                    Update Your Photo
                  </p>
                  <p className="text-xs" style={{ color: colors.navy, opacity: 0.7 }}>
                    Re-take your profile photo every few months for accurate measurements.
                  </p>
                </div>

                <div className="p-4 rounded-lg" style={{ backgroundColor: colors.cream }}>
                  <p className="text-2xl mb-2">✨</p>
                  <p className="font-semibold mb-1 text-sm" style={{ color: colors.navy }}>
                    Try Combinations
                  </p>
                  <p className="text-xs" style={{ color: colors.navy, opacity: 0.7 }}>
                    Create outfit combos with your {totalItems} items to plan ahead!
                  </p>
                </div>
              </div>
            </div>

            {/* Empty State */}
            {totalItems === 0 && (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm border-2" style={{ borderColor: colors.peach }}>
                <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.peach }}>
                  <span className="text-4xl">📊</span>
                </div>
                <h3 className="text-2xl font-bold mb-2" style={{ color: colors.navy }}>
                  Start Building Your Wardrobe
                </h3>
                <p className="text-sm mb-6" style={{ color: colors.navy, opacity: 0.6 }}>
                  Add your first items to see personalized insights and recommendations
                </p>
                <button
                  onClick={() => router.push('/items')}
                  className="px-6 py-3 rounded-lg font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: colors.navy }}
                >
                  Add Your First Item
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}