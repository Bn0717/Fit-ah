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
    if (!authLoading && !user) router.push('/login');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [userItems, userProfile] = await Promise.all([getUserClothingItems(user.uid), getAvatar(user.uid)]);
      setItems(userItems);
      setProfile(userProfile);
    } catch (error) { console.error('Error loading dashboard:', error); }
    finally { setLoading(false); }
  };

  const totalItems = items.length;
  const favoriteItems = items.filter(i => i.isFavorite).length;
  const brandCounts: Record<string, number> = {};
  items.forEach(item => { brandCounts[item.brand] = (brandCounts[item.brand] || 0) + 1; });
  const topBrand = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0];
  const categoryCounts: Record<string, number> = {};
  items.forEach(item => { categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1; });
  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
  const sizesByBrand: Record<string, Set<string>> = {};
  items.forEach(item => {
    if (!sizesByBrand[item.brand]) sizesByBrand[item.brand] = new Set();
    item.sizeChart.forEach(size => sizesByBrand[item.brand].add(size.size));
  });
  const totalMoneySpent = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: colors.cream }}>
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: colors.navy, borderTopColor: 'transparent' }} />
          <p className="font-semibold" style={{ color: colors.navy }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: colors.cream }}>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">

        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2" style={{ color: colors.navy }}>Dashboard</h1>
          <p className="text-base sm:text-lg" style={{ color: colors.navy, opacity: 0.7 }}>Your wardrobe insights and recommendations</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
            <DashboardCardSkeleton /><DashboardCardSkeleton /><DashboardCardSkeleton /><DashboardCardSkeleton />
          </div>
        ) : (
          <>
            {/* Stats Overview */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">

              {/* Total Items */}
              <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border-2 transition-all hover:shadow-md" style={{ borderColor: colors.peach }}>
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <span className="text-xs sm:text-sm font-semibold" style={{ color: colors.navy, opacity: 0.6 }}>TOTAL ITEMS</span>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.peach }}>
                    <span className="text-lg sm:text-xl">👔</span>
                  </div>
                </div>
                <p className="text-3xl sm:text-4xl font-bold mb-1" style={{ color: colors.navy }}>{totalItems}</p>
                <p className="text-xs" style={{ color: colors.navy, opacity: 0.5 }}>{favoriteItems} favorites</p>
              </div>

              {/* Top Brand */}
              <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border-2 transition-all hover:shadow-md" style={{ borderColor: colors.pink }}>
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <span className="text-xs sm:text-sm font-semibold" style={{ color: colors.navy, opacity: 0.6 }}>TOP BRAND</span>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.pink }}>
                    <span className="text-lg sm:text-xl">⭐</span>
                  </div>
                </div>
                <p className="text-lg sm:text-2xl font-bold mb-1 truncate" style={{ color: colors.navy }}>{topBrand ? topBrand[0] : '-'}</p>
                <p className="text-xs" style={{ color: colors.navy, opacity: 0.5 }}>{topBrand ? `${topBrand[1]} items` : 'Add items to see stats'}</p>
              </div>

              {/* Most Worn */}
              <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border-2 transition-all hover:shadow-md" style={{ borderColor: colors.peach }}>
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <span className="text-xs sm:text-sm font-semibold" style={{ color: colors.navy, opacity: 0.6 }}>MOST WORN</span>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.peach }}>
                    <span className="text-lg sm:text-xl">
                      {topCategory?.[0] === 'Shirt' ? '👕' : topCategory?.[0] === 'Jacket' ? '🧥' : topCategory?.[0] === 'Pants' ? '👖' : '📦'}
                    </span>
                  </div>
                </div>
                <p className="text-lg sm:text-2xl font-bold mb-1" style={{ color: colors.navy }}>{topCategory ? topCategory[0] : '-'}</p>
                <p className="text-xs" style={{ color: colors.navy, opacity: 0.5 }}>{topCategory ? `${topCategory[1]} items` : 'Add items to see stats'}</p>
              </div>

              {/* Total Spent */}
              <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border-2 transition-all hover:shadow-md" style={{ borderColor: colors.pink }}>
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <span className="text-xs sm:text-sm font-semibold leading-tight" style={{ color: colors.navy, opacity: 0.6 }}>TOTAL SPENT</span>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: colors.pink }}>
                    <span className="text-lg sm:text-xl">💰</span>
                  </div>
                </div>
                <p className="text-xl sm:text-3xl font-bold mb-1" style={{ color: colors.navy }}>RM {totalMoneySpent.toFixed(2)}</p>
                <p className="text-xs" style={{ color: colors.navy, opacity: 0.5 }}>All wardrobe items</p>
              </div>

            </div>

            {/* Size Insights */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">

              {/* Size Variability */}
              <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border-2" style={{ borderColor: colors.peach }}>
                <h3 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4" style={{ color: colors.navy }}>📊 Size Varies by Brand</h3>
                {Object.keys(sizesByBrand).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(sizesByBrand).slice(0, 5).map(([brand, sizes]) => (
                      <div key={brand}>
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className="font-semibold text-sm truncate" style={{ color: colors.navy }}>{brand}</span>
                          <span className="text-xs px-2 py-1 rounded-full font-bold flex-shrink-0" style={{ backgroundColor: colors.pink, color: colors.navy }}>
                            {Array.from(sizes).join(', ')}
                          </span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: colors.cream }}>
                          <div className="h-full rounded-full" style={{ width: `${(brandCounts[brand] / totalItems) * 100}%`, backgroundColor: colors.navy }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm" style={{ color: colors.navy, opacity: 0.6 }}>Add more items to see size insights</p>
                  </div>
                )}
              </div>

              {/* Profile Status */}
              <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border-2" style={{ borderColor: colors.pink }}>
                <h3 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4" style={{ color: colors.navy }}>👤 Your Profile</h3>
                {profile ? (
                  <div className="space-y-3 sm:space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      {[
                        { label: 'Height', value: `${(profile as any).height} cm` },
                        { label: 'Chest', value: `${(profile as any).chest} cm` },
                        { label: 'Waist', value: `${(profile as any).waist} cm` },
                        { label: 'Shoulder', value: `${(profile as any).shoulder} cm` },
                      ].map(({ label, value }) => (
                        <div key={label} className="p-3 rounded-lg" style={{ backgroundColor: colors.cream }}>
                          <p className="text-xs font-semibold mb-1" style={{ color: colors.navy, opacity: 0.6 }}>{label}</p>
                          <p className="text-lg sm:text-xl font-bold" style={{ color: colors.navy }}>{value}</p>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => router.push('/profile')}
                      className="w-full px-4 py-2 rounded-lg font-medium text-sm transition-all hover:opacity-90"
                      style={{ backgroundColor: colors.peach, color: colors.navy }}>
                      Update Measurements
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm mb-4" style={{ color: colors.navy, opacity: 0.6 }}>
                      Complete your profile to get personalized fit recommendations
                    </p>
                    <button onClick={() => router.push('/profile')}
                      className="px-6 py-3 rounded-lg font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: colors.navy }}>
                      Set Up Profile
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border-2" style={{ borderColor: colors.peach }}>
              <h3 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4" style={{ color: colors.navy }}>💡 Recommendations for You</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                {[
                  {
                    icon: '🎯',
                    title: 'Stay Consistent',
                    desc: `You prefer ${topBrand?.[0] || 'certain brands'}. Try their new collections for similar fits!`
                  },
                  {
                    icon: '📸',
                    title: 'Update Your Photo',
                    desc: 'Re-take your profile photo every few months for accurate measurements.'
                  },
                  {
                    icon: '✨',
                    title: 'Try Combinations',
                    desc: `Create outfit combos with your ${totalItems} items to plan ahead!`
                  }
                ].map(({ icon, title, desc }) => (
                  <div key={title} className="p-4 rounded-lg" style={{ backgroundColor: colors.cream }}>
                    <p className="text-2xl mb-2">{icon}</p>
                    <p className="font-semibold mb-1 text-sm" style={{ color: colors.navy }}>{title}</p>
                    <p className="text-xs" style={{ color: colors.navy, opacity: 0.7 }}>{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Empty State */}
            {totalItems === 0 && (
              <div className="bg-white rounded-xl p-8 sm:p-12 text-center shadow-sm border-2 mt-4 sm:mt-6" style={{ borderColor: colors.peach }}>
                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.peach }}>
                  <span className="text-3xl sm:text-4xl">📊</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold mb-2" style={{ color: colors.navy }}>Start Building Your Wardrobe</h3>
                <p className="text-sm mb-6" style={{ color: colors.navy, opacity: 0.6 }}>
                  Add your first items to see personalized insights and recommendations
                </p>
                <button onClick={() => router.push('/items')}
                  className="px-6 py-3 rounded-lg font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: colors.navy }}>
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