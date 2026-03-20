// app/signup/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signUp, signInWithGoogle } from '@/lib/firebase/auth';
import { useAuth } from '@/lib/contexts/AuthContext';

const colors = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC'
};

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // FIXED LOADING STATES
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const isAnyLoading = isEmailLoading || isGoogleLoading;

  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      router.push('/onboarding');
    }
  }, [user, router]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAnyLoading) return; // Prevent double submissions
    setError(null);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsEmailLoading(true);

    const { user, error: signUpError } = await signUp(email, password);

    if (signUpError) {
      if (signUpError.includes('email-already-in-use')) {
        setError('This email is already registered. Try logging in instead.');
      } else if (signUpError.includes('invalid-email')) {
        setError('Please enter a valid email address');
      } else if (signUpError.includes('weak-password')) {
        setError('Password is too weak. Use at least 6 characters.');
      } else {
        setError(signUpError);
      }
      setIsEmailLoading(false);
      return;
    }

    if (user) {
      router.push('/onboarding');
    }
  };

  const handleGoogleSignup = async () => {
    if (isAnyLoading) return; // Prevent multiple popup requests
    setError(null);
    setIsGoogleLoading(true);

    try {
      const { user, error: googleError } = await signInWithGoogle();

      if (googleError) {
        if (googleError.includes('popup-closed-by-user') || googleError.includes('cancelled')) {
          setIsGoogleLoading(false);
          return;
        }
        setError(googleError);
        setIsGoogleLoading(false);
        return;
      }

      if (user) {
        setTimeout(() => {
          router.push('/onboarding');
        }, 500);
      } else {
        setIsGoogleLoading(false);
      }
    } catch (err: any) {
      setError('An unexpected error occurred. Please try again.');
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: colors.cream }}>
      {/* Left Side - Branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-12" style={{ backgroundColor: colors.navy }}>
        <div className="max-w-md">
          <h1 className="text-5xl font-black mb-4 text-white">Fit-Ah</h1>
          <p className="text-xl text-white opacity-80 mb-8">Never buy the wrong size again</p>
          <div className="space-y-4">
            {['AI-powered size recommendations', 'Virtual try-on technology', 'Precision Fit'].map(item => (
              <div key={item} className="flex items-center gap-3 text-white">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: colors.pink }}>
                  <svg className="w-5 h-5" style={{ color: colors.navy }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Side - Signup Form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="bg-white rounded-2xl shadow-sm border-2 p-6 sm:p-8 w-full max-w-md" style={{ borderColor: colors.peach }}>
          {/* Mobile branding */}
          <div className="lg:hidden text-center mb-6">
            <h1 className="text-3xl font-black mb-1" style={{ color: colors.navy }}>Fit-Ah</h1>
            <p className="text-sm opacity-60" style={{ color: colors.navy }}>Join thousands finding their perfect fit</p>
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2" style={{ color: colors.navy }}>Create Account</h2>
          <p className="text-sm mb-6 sm:mb-8" style={{ color: colors.navy, opacity: 0.6 }}>Start finding your perfect fit today</p>

            <div className="mb-6 p-3 rounded-lg border text-center" style={{ backgroundColor: colors.cream, borderColor: colors.peach }}>
              <p className="text-[11px]" style={{ color: colors.navy }}>
                Looking for the demo? 
                <button onClick={() => router.push('/login')} className="ml-1 font-bold underline">
                  Click here to use the Sample Account
                </button>
              </p>
            </div>

          {error && (
            <div className="mb-4 sm:mb-6 p-3 sm:p-4 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm font-medium text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4 sm:space-y-6">
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: colors.navy }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none text-sm sm:text-base"
                style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }}
                required
                disabled={isAnyLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: colors.navy }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none text-sm sm:text-base"
                style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }}
                required
                disabled={isAnyLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: colors.navy }}>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none text-sm sm:text-base"
                style={{ borderColor: colors.peach, backgroundColor: colors.cream, color: colors.navy }}
                required
                disabled={isAnyLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isAnyLoading}
              className="w-full py-3 px-4 rounded-lg font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: colors.navy }}
            >
              {isEmailLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div className="flex items-center gap-4 my-4 sm:my-6">
            <div className="flex-1 h-px" style={{ backgroundColor: colors.peach }} />
            <span className="text-sm" style={{ color: colors.navy, opacity: 0.5 }}>OR</span>
            <div className="flex-1 h-px" style={{ backgroundColor: colors.peach }} />
          </div>

          <button
            onClick={handleGoogleSignup}
            disabled={isAnyLoading}
            className="w-full py-3 px-4 rounded-lg font-semibold border-2 transition-all hover:shadow-sm flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
            style={{ borderColor: colors.peach, backgroundColor: 'white', color: colors.navy }}
          >
            {isGoogleLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: colors.navy }} />
                Connecting...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign up with Google
              </>
            )}
          </button>

          <p className="mt-3 text-[10px] text-center italic px-4" style={{ color: colors.navy, opacity: 0.5 }}>
            Note: Google Login is currently in restricted test mode. Please sign in using the Email method above.
          </p>

          <p className="text-center mt-4 sm:mt-6 text-sm" style={{ color: colors.navy, opacity: 0.6 }}>
            Already have an account?{' '}
            <button
              onClick={() => router.push('/login')}
              className="font-semibold hover:underline"
              style={{ color: colors.navy }}
              disabled={isAnyLoading}
            >
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}