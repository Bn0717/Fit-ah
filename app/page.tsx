// app/page.tsx
// The home page just forwards: signed in → your profile, otherwise → the login page (which is also the landing page).
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading) router.replace(user ? '/profile' : '/login');
  }, [user, loading, router]);

  return <div className="min-h-screen" style={{ backgroundColor: '#F8F3EA' }} />;
}
