// components/ui/Navbar.tsx
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
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setShowMobileMenu(false);
  }, [pathname]);

  if (pathname === '/login' || pathname === '/signup') {
    return null;
  }

  const handleLogout = async () => {
    await logout();
    setShowDropdown(false);
    setShowMobileMenu(false);
    router.push('/login');
  };

  const isActive = (path: string) => pathname === path;

  const navLinks = [
    { href: '/profile', label: 'Profile' },
    { href: '/items', label: 'Wardrobe' },
    { href: '/dashboard', label: 'Dashboard' },
  ];

  return (
    <nav className="border-b sticky top-0 z-40" style={{ backgroundColor: colors.cream, borderColor: colors.peach }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
        <div className="flex items-center justify-between">

          {/* Logo */}
          <Link href="/" className="text-xl sm:text-2xl font-bold transition-opacity hover:opacity-80 flex-shrink-0" style={{ color: colors.navy }}>
            Fit-Ah
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(link => (
              <NavLink key={link.href} href={link.href} isActive={isActive(link.href)}>
                {link.label}
              </NavLink>
            ))}
          </div>

          {/* Right: user avatar (desktop) + hamburger (mobile) */}
          <div className="flex items-center gap-2">
            {user && (
              <div className="relative hidden md:block" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white transition-transform hover:scale-105 text-sm"
                  style={{ backgroundColor: colors.navy }}
                >
                  {user.email?.[0].toUpperCase()}
                </button>

                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-64 rounded-xl shadow-lg border-2 overflow-hidden z-50"
                    style={{ backgroundColor: 'white', borderColor: colors.peach }}>
                    <div className="p-4" style={{ backgroundColor: colors.cream }}>
                      <p className="text-xs font-semibold" style={{ color: colors.navy, opacity: 0.6 }}>Signed in as</p>
                      <p className="text-sm font-bold truncate" style={{ color: colors.navy }}>{user.email}</p>
                    </div>
                    <div className="p-2">
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

            {/* Mobile hamburger */}
            <button
              className="md:hidden flex flex-col justify-center items-center w-9 h-9 gap-1.5 rounded-lg transition-all"
              style={{ backgroundColor: showMobileMenu ? colors.peach : 'transparent' }}
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              aria-label="Toggle menu"
            >
              <span className={`block w-5 h-0.5 transition-all duration-300 ${showMobileMenu ? 'rotate-45 translate-y-2' : ''}`}
                style={{ backgroundColor: colors.navy }} />
              <span className={`block w-5 h-0.5 transition-all duration-300 ${showMobileMenu ? 'opacity-0 scale-x-0' : ''}`}
                style={{ backgroundColor: colors.navy }} />
              <span className={`block w-5 h-0.5 transition-all duration-300 ${showMobileMenu ? '-rotate-45 -translate-y-2' : ''}`}
                style={{ backgroundColor: colors.navy }} />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {showMobileMenu && (
        <div className="md:hidden border-t" style={{ borderColor: colors.peach, backgroundColor: colors.cream }}>
          <div className="px-4 py-3 space-y-1">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center px-4 py-3 rounded-xl font-semibold text-sm transition-all"
                style={{
                  backgroundColor: isActive(link.href) ? colors.navy : 'transparent',
                  color: isActive(link.href) ? 'white' : colors.navy,
                }}
              >
                {link.label}
              </Link>
            ))}
            {user && (
              <>
                <div className="border-t my-2" style={{ borderColor: colors.peach }} />
                <div className="px-4 py-2">
                  <p className="text-xs font-semibold opacity-60" style={{ color: colors.navy }}>Signed in as</p>
                  <p className="text-sm font-bold truncate" style={{ color: colors.navy }}>{user.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  disabled={loading}
                  className="w-full text-left px-4 py-3 rounded-xl text-sm font-semibold transition-colors hover:opacity-70 disabled:opacity-50"
                  style={{ color: colors.navy, backgroundColor: colors.peach }}
                >
                  {loading ? '🔄 Logging out...' : '👋 Logout'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

function NavLink({ href, isActive, children }: { href: string; isActive: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className="relative px-4 py-2 font-semibold transition-all group" style={{ color: colors.navy }}>
      <span className={isActive ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}>{children}</span>
      {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ backgroundColor: colors.navy }} />}
      {!isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: colors.pink }} />}
    </Link>
  );
}