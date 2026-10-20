// components/login/LoginCard.tsx
// The sign-in form: demo auto-fill + email and password (same sign-in logic as the old /login page).
// Google sign-in, sign-up and forgot password are hidden here for now; handleGoogleLogin stays so they can come back.
// useLoginForm holds the state so the same form can appear in the slide-in panel and at the bottom of the
// page without getting out of sync.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signInWithGoogle, resetPassword } from '@/lib/firebase/auth';

export const colors = { cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC' };

export function useLoginForm(onSignedIn?: (uid: string) => void | Promise<void>) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const isAnyLoading = isEmailLoading || isGoogleLoading;
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const fillDemoCredentials = () => { setEmail('fitah@gmail.com'); setPassword('123456'); setError(null); };

  const goNext = async (uid: string) => {
    if (onSignedIn) return onSignedIn(uid);           // the page plays its own transition
    router.push('/items');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isAnyLoading) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Please enter a valid email address'); return; }
    setIsEmailLoading(true);
    const { user, error: signInError } = await signIn(email, password);
    if (signInError) {
      if (signInError.includes('user-not-found') || signInError.includes('wrong-password') || signInError.includes('invalid-credential')) {
        setError('Invalid email or password. Please try again.');
      } else if (signInError.includes('too-many-requests')) {
        setError('Too many failed attempts. Please try again later or reset your password.');
      } else if (signInError.includes('invalid-email')) {
        setError('Please enter a valid email address');
      } else {
        setError(signInError);
      }
      setIsEmailLoading(false);
      return;
    }
    if (user) await goNext(user.uid);
  };

  const handleGoogleLogin = async () => {
    if (isGoogleLoading || isEmailLoading) return;
    setError(null);
    setIsGoogleLoading(true);
    try {
      const { user, error: googleError } = await signInWithGoogle();
      if (googleError) {
        if (googleError !== 'popup-closed-by-user') setError(googleError);   // closing the popup is not an error
        return;
      }
      if (user) await goNext(user.uid);
    } catch (err) {
      console.error('Unexpected Auth Error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!resetEmail.trim()) { setError('Please enter your email address'); return; }
    setResetLoading(true); setError(null);
    const { success, error: resetError } = await resetPassword(resetEmail);
    if (resetError) { setError(resetError); setResetLoading(false); return; }
    if (success) {
      setResetSuccess(true); setResetLoading(false);
      setTimeout(() => { setShowResetModal(false); setResetSuccess(false); setResetEmail(''); }, 3000);
    }
  };

  return {
    email, setEmail, password, setPassword, error, setError, isEmailLoading, isGoogleLoading, isAnyLoading,
    showResetModal, setShowResetModal, resetEmail, setResetEmail, resetSuccess, setResetSuccess, resetLoading,
    fillDemoCredentials, handleLogin, handleGoogleLogin, handlePasswordReset, router,
  };
}
export type LoginForm = ReturnType<typeof useLoginForm>;

export function LoginCard({ f, idPrefix }: { f: LoginForm; idPrefix: string }) {
  const { navy, peach, cream } = colors;
  return (
    <div className="bg-white rounded-2xl shadow-sm border-2 p-6 sm:p-8 w-full max-w-md" style={{ borderColor: peach }}>
      <h2 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2" style={{ color: navy }}>Welcome Back</h2>
      <p className="text-sm mb-6" style={{ color: navy, opacity: 0.6 }}>Sign in to access your wardrobe</p>

      <div className="mb-6 p-4 rounded-xl border-2 border-dashed text-center" style={{ borderColor: peach, backgroundColor: cream, color: navy }}>
        <p className="text-xs font-bold mb-1">QUICK DEMO ACCESS</p>
        <p className="text-[10px] leading-relaxed mb-3" style={{ opacity: 0.7 }}>
          Use the demo account below to explore our full sample wardrobe straight away:
        </p>
        <div className="bg-white py-2 px-3 rounded-lg border shadow-sm inline-block w-full">
          <div className="flex flex-col sm:flex-row justify-between gap-1 text-[11px] font-mono">
            <span>Email: <strong className="select-all">fitah@gmail.com</strong></span>
            <span className="hidden sm:inline opacity-30">|</span>
            <span>Password: <strong className="select-all">123456</strong></span>
          </div>
        </div>
        <button type="button" onClick={f.fillDemoCredentials}
          className="mt-4 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-90 active:scale-95 shadow-sm"
          style={{ backgroundColor: navy, color: 'white' }}>
          Auto-fill Credentials
        </button>
      </div>

      {f.error && !f.showResetModal && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm font-medium text-red-700">{f.error}</p>
        </div>
      )}

      <form onSubmit={f.handleLogin} className="space-y-4 sm:space-y-5">
        <div>
          <label htmlFor={`${idPrefix}-email`} className="block text-sm font-semibold mb-2" style={{ color: navy }}>Email</label>
          <input id={`${idPrefix}-email`} type="email" value={f.email} onChange={e => f.setEmail(e.target.value)}
            placeholder="you@example.com" autoComplete="email"
            className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none text-sm sm:text-base"
            style={{ borderColor: peach, backgroundColor: cream, color: navy }} required disabled={f.isAnyLoading} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-password`} className="block text-sm font-semibold mb-2" style={{ color: navy }}>Password</label>
          <input id={`${idPrefix}-password`} type="password" value={f.password} onChange={e => f.setPassword(e.target.value)}
            placeholder="••••••••" autoComplete="current-password"
            className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none text-sm sm:text-base"
            style={{ borderColor: peach, backgroundColor: cream, color: navy }} required disabled={f.isAnyLoading} />
        </div>
        <button type="submit" disabled={f.isAnyLoading}
          className="w-full py-3 px-4 rounded-lg font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ backgroundColor: navy }}>
          {f.isEmailLoading ? (<><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Signing in...</>) : 'Sign In'}
        </button>
      </form>

    </div>
  );
}

export function ResetModal({ f }: { f: LoginForm }) {
  const { navy, peach, cream } = colors;
  if (!f.showResetModal) return null;
  const close = () => { f.setShowResetModal(false); f.setResetSuccess(false); f.setError(null); };
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold" style={{ color: navy }}>Reset Password</h2>
            <button onClick={close} disabled={f.resetLoading} aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:opacity-70" style={{ backgroundColor: cream }}>
              <svg className="w-5 h-5" style={{ color: navy }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {f.resetSuccess ? (
            <div className="p-4 rounded-lg mb-4" style={{ backgroundColor: peach }}>
              <p className="text-sm font-medium" style={{ color: navy }}>✅ Password reset email sent! Check your inbox.</p>
            </div>
          ) : (
            <>
              <p className="text-sm mb-4 sm:mb-6" style={{ color: navy, opacity: 0.7 }}>
                Enter your email address and we&apos;ll send you a link to reset your password.
              </p>
              {f.error && (
                <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm font-medium text-red-700">{f.error}</p>
                </div>
              )}
              <div className="mb-4 sm:mb-6">
                <label className="block text-sm font-semibold mb-2" style={{ color: navy }}>Email Address</label>
                <input type="email" value={f.resetEmail} onChange={e => f.setResetEmail(e.target.value)} placeholder="you@example.com"
                  className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none"
                  style={{ borderColor: peach, backgroundColor: cream, color: navy }} disabled={f.resetLoading} />
              </div>
              <div className="flex gap-3">
                <button onClick={close} disabled={f.resetLoading}
                  className="flex-1 px-4 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 text-sm"
                  style={{ backgroundColor: cream, color: navy }}>Cancel</button>
                <button onClick={f.handlePasswordReset} disabled={f.resetLoading}
                  className="flex-1 px-4 py-3 rounded-lg font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  style={{ backgroundColor: navy }}>
                  {f.resetLoading ? (<><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Sending...</>) : 'Send Reset Link'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
