// app/profile/page.tsx - FIXED
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useProfile } from '@/lib/hooks/useProfile';
import AutoDetectMeasurements from '@/components/profile/AutoDetectMeasurements';
import User3DModel from '@/components/profile/User3DModel';
import AvaturnCreator from '@/components/profile/AvaturnCreator';

const colors = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC'
};

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  
  const { profile, loading, saving, error, saveProfile } = useProfile(user?.uid || '');
  
  const [measurements, setMeasurements] = useState({
    height: 175,
    chest: 95,
    waist: 80,
    shoulder: 45
  });

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAvaturn, setShowAvaturn] = useState(false);
  
  // Avatar and animation state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [selectedAnimation, setSelectedAnimation] = useState<string | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // Load profile data
  useEffect(() => {
    if (profile) {
      setMeasurements({
        height: profile.height,
        chest: profile.chest,
        waist: profile.waist,
        shoulder: profile.shoulder,
      });
      if (profile.photoUrl) setPhotoPreview(profile.photoUrl);
      if (profile.avatarUrl) setAvatarUrl(profile.avatarUrl);
      if (profile.selectedAnimation) setSelectedAnimation(profile.selectedAnimation);
    }
  }, [profile]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // ✅ FIXED: Correct type for data parameter
  const handleAvatarExported = async (data: { url: string; animationName?: string }) => {
    console.log("🎉 Avatar exported:", data);
    
    setAvatarUrl(data.url);
    if (data.animationName) {
      setSelectedAnimation(data.animationName);
    }
    setShowAvaturn(false);

    // Save to Firebase
    if (user) {
      await saveProfile({ 
        ...measurements, 
        avatarUrl: data.url,
        selectedAnimation: data.animationName || null
      });
      setSuccessMessage('Avatar created successfully! ✅');
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  // Handle animation change from 3D viewer
  const handleAnimationChange = async (animationName: string) => {
    console.log("🎬 Changing animation to:", animationName);
    setSelectedAnimation(animationName);

    // Auto-save the selected animation
    if (user) {
      await saveProfile({ 
        ...measurements, 
        avatarUrl: avatarUrl || undefined,
        selectedAnimation: animationName
      });
      setSuccessMessage(`Animation changed to ${animationName}! ✅`);
      setTimeout(() => setSuccessMessage(null), 2000);
    }
  };

  const handleMeasurementChange = (field: string, value: number) => {
    setMeasurements(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!user) return;
    
    setSuccessMessage(null);
    const result = await saveProfile(
      { 
        ...measurements, 
        avatarUrl: avatarUrl || undefined, 
        selectedAnimation: selectedAnimation || undefined 
      }, 
      photoFile || undefined
    );
    
    if (result.success) {
      setSuccessMessage('Profile saved successfully! ✅');
      setPhotoFile(null);
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  // Show loading while checking auth
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: colors.cream }}>
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: colors.navy, borderTopColor: 'transparent' }}></div>
          <p className="font-semibold" style={{ color: colors.navy }}>Loading profile...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen flex bg-[#F8F3EA]">
    
      {/* LEFT SIDEBAR */}
      <div className="w-80 border-r border-[#FFDBD1] bg-white overflow-y-auto p-6">
        <h1 className="text-xl font-black text-[#0B1957] mb-6">PROFILE SETUP</h1>
        
        {/* Success Message */}
        {successMessage && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200">
            <p className="text-sm font-semibold text-green-700">{successMessage}</p>
          </div>
        )}
        
        {/* Photo Preview Card */}
        <div className="rounded-2xl overflow-hidden border-2 border-[#FFDBD1] bg-[#F8F3EA] mb-6">
          {photoPreview ? (
            <img src={photoPreview} className="w-full h-48 object-cover" alt="Profile" />
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400">No Photo</div>
          )}
          <label className="block p-3 text-center text-xs font-bold text-[#0B1957] cursor-pointer hover:bg-white transition-colors">
            CHANGE PHOTO
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </label>
        </div>

        <AutoDetectMeasurements 
          photoUrl={photoPreview || ''} 
          onMeasurementsDetected={setMeasurements} 
        />
      </div>

      {/* RIGHT CONTENT */}
      <div className="flex-1 p-10 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-10">
            <div>
              <h2 className="text-3xl font-bold text-[#0B1957]">Your Digital Twin</h2>
              {selectedAnimation && (
                <p className="text-sm text-gray-600 mt-1">
                  Current animation: <span className="font-semibold">{selectedAnimation}</span>
                </p>
              )}
            </div>
            <button 
              onClick={() => setShowAvaturn(true)}
              className="px-8 py-4 bg-[#0B1957] text-white rounded-2xl font-bold shadow-xl hover:scale-105 transition-all flex items-center gap-3"
            >
              ✨ Create Realistic Avatar
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
            
            {/* 3D VIEWER - WITH ANIMATION CONTROLS */}
            <div className="xl:col-span-2">
              <User3DModel 
                avatarUrl={avatarUrl} 
                measurements={measurements}
                selectedAnimation={selectedAnimation}
                onAnimationChange={handleAnimationChange}
              />
            </div>

            {/* MEASUREMENT INPUTS */}
            <div className="bg-white rounded-3xl border-2 border-[#FFDBD1] p-8 h-fit shadow-sm">
              <h3 className="text-lg font-bold text-[#0B1957] mb-6 border-b border-[#F8F3EA] pb-4">Body Metrics (cm)</h3>
              <div className="grid grid-cols-1 gap-6">
                {[
                  { label: 'Height', key: 'height' },
                  { label: 'Chest', key: 'chest' },
                  { label: 'Waist', key: 'waist' },
                  { label: 'Shoulder', key: 'shoulder' }
                ].map((m) => (
                  <div key={m.key}>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{m.label}</label>
                    <input
                      type="number"
                      value={measurements[m.key as keyof typeof measurements]}
                      onChange={(e) => handleMeasurementChange(m.key, Number(e.target.value))}
                      className="w-full mt-2 px-5 py-4 rounded-xl border border-[#FFDBD1] bg-[#F8F3EA] text-[#0B1957] font-bold text-lg focus:ring-4 focus:ring-[#FFDBD1] transition-all outline-none"
                    />
                  </div>
                ))}
              </div>
              
              <button 
                onClick={handleSave}
                disabled={saving}
                className="w-full mt-8 py-4 bg-[#FA9EBC] text-[#0B1957] rounded-xl font-black uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* Avaturn Creator Modal */}
      {showAvaturn && (
        <AvaturnCreator 
          onAvatarExported={handleAvatarExported} 
          onClose={() => setShowAvaturn(false)} 
        />
      )}
    </div>
  );
}