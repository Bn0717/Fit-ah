// components/ui/Navbar.tsx - VERSION WITH SMOOTH HOVER UNDERLINE
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';

const colors = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC'
};

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, loading } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 1. Move the useEffect UP (before the early return)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 2. NOW you can safely check the pathname and return early
  if (pathname === '/login' || pathname === '/signup') {
    return null;
  }

  const handleLogout = async () => {
    await logout();
    setShowDropdown(false);
    router.push('/login');
  };

  const isActive = (path: string) => pathname === path;

  return (
    <nav className="border-b sticky top-0 z-40" style={{ backgroundColor: colors.cream, borderColor: colors.peach }}>
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          
          {/* Logo */}
          <Link href="/" className="text-2xl font-bold transition-opacity hover:opacity-80" style={{ color: colors.navy }}>
            FitCheck
          </Link>

          {/* Navigation Links - SMOOTH HOVER VERSION */}
          <div className="flex items-center gap-1">
            {/*<NavLink href="/" isActive={isActive('/')}>
              Home
            </NavLink>*/}
            
            <NavLink href="/profile" isActive={isActive('/profile')}>
              Profile
            </NavLink>
            
            <NavLink href="/items" isActive={isActive('/items')}>
              Wardrobe
            </NavLink>
            
            <NavLink href="/dashboard" isActive={isActive('/dashboard')}>
              Dashboard
            </NavLink>
            
            {/*<NavLink href="/try-on" isActive={isActive('/try-on')}>
              Try-On
            </NavLink>*/}
          </div>

          {/* User Menu */}
          {user && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white transition-transform hover:scale-105"
                style={{ backgroundColor: colors.navy }}
              >
                {user.email?.[0].toUpperCase()}
              </button>

              {showDropdown && (
                <div 
                  className="absolute right-0 mt-2 w-64 rounded-xl shadow-lg border-2 overflow-hidden"
                  style={{ backgroundColor: 'white', borderColor: colors.peach }}
                >
                  <div className="p-4" style={{ backgroundColor: colors.cream }}>
                    <p className="text-xs font-semibold" style={{ color: colors.navy, opacity: 0.6 }}>
                      Signed in as
                    </p>
                    <p className="text-sm font-bold truncate" style={{ color: colors.navy }}>
                      {user.email}
                    </p>
                  </div>

                  <div className="p-2">
                    <Link
                      href="/profile"
                      onClick={() => setShowDropdown(false)}
                      className="block px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-70"
                      style={{ color: colors.navy }}
                    >
                      ⚙️ Settings
                    </Link>
                    <button
                      onClick={handleLogout}
                      disabled={loading}
                      className="w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-70 disabled:opacity-50"
                      style={{ color: colors.navy }}
                    >
                      {loading ? '🔄 Logging out...' : '👋 Logout'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </nav>
  );
}

// Custom NavLink component with smooth hover effect
function NavLink({ href, isActive, children }: { href: string; isActive: boolean; children: React.ReactNode }) {
  return (
    <Link 
      href={href}
      className="relative px-4 py-2 font-semibold transition-all group"
      style={{ color: colors.navy }}
    >
      {/* Text */}
      <span className={isActive ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}>
        {children}
      </span>
      
      {/* Active indicator - doesn't cause layout shift */}
      {isActive && (
        <div 
          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
          style={{ backgroundColor: colors.navy }}
        />
      )}
      
      {/* Hover indicator - only shows when not active */}
      {!isActive && (
        <div 
          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: colors.pink }}
        />
      )}
    </Link>
  );
}