// app/page.tsx - RESPONSIVE
'use client';

import { useRouter } from 'next/navigation';

const colors = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC'
};

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ backgroundColor: colors.cream }}>
      <div className="max-w-4xl w-full mx-auto text-center">
        {/* Logo/Brand */}
        <div className="mb-8">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black mb-3 sm:mb-4" style={{ color: colors.navy }}>
            Fit-Ah
          </h1>
          <p className="text-base sm:text-xl" style={{ color: colors.navy, opacity: 0.7 }}>
            AI-Powered Virtual Try-On & Size Recommendations
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-12">
          <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border-2" style={{ borderColor: colors.peach }}>
            <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.peach }}>
              <svg className="w-6 h-6 sm:w-8 sm:h-8" style={{ color: colors.navy }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="font-bold text-base sm:text-lg mb-1 sm:mb-2" style={{ color: colors.navy }}>Create Profile</h3>
            <p className="text-xs sm:text-sm" style={{ color: colors.navy, opacity: 0.6 }}>Upload your photo and measurements</p>
          </div>

          <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border-2" style={{ borderColor: colors.pink }}>
            <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.pink }}>
              <svg className="w-6 h-6 sm:w-8 sm:h-8" style={{ color: colors.navy }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <h3 className="font-bold text-base sm:text-lg mb-1 sm:mb-2" style={{ color: colors.navy }}>Add Items</h3>
            <p className="text-xs sm:text-sm" style={{ color: colors.navy, opacity: 0.6 }}>Upload clothing from your favorite brands</p>
          </div>

          <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border-2" style={{ borderColor: colors.navy }}>
            <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.navy }}>
              <svg className="w-6 h-6 sm:w-8 sm:h-8" style={{ color: 'white' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-bold text-base sm:text-lg mb-1 sm:mb-2" style={{ color: colors.navy }}>Get Perfect Fit</h3>
            <p className="text-xs sm:text-sm" style={{ color: colors.navy, opacity: 0.6 }}>AI-powered size recommendations</p>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
          <button
            onClick={() => router.push('/profile')}
            className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: colors.navy }}
          >
            Get Started
          </button>
          <button
            onClick={() => router.push('/profile')}
            className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: colors.peach, color: colors.navy }}
          >
            Try Demo
          </button>
        </div>

        {/* Navigation Links */}
        <div className="mt-8 sm:mt-12 flex gap-4 sm:gap-6 justify-center flex-wrap">
          {[
            { href: '/profile', label: 'Profile' },
            { href: '/items', label: 'Items' },
            { href: '/try-on', label: 'Try-On' },
          ].map(link => (
            <button
              key={link.href}
              onClick={() => router.push(link.href)}
              className="text-sm font-medium hover:underline"
              style={{ color: colors.navy }}
            >
              {link.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}