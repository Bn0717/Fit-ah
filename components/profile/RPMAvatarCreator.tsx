// components/profile/RPMAvatarCreator.tsx - Not use in latest development, but keep for reference
'use client';

import { AvatarCreator, AvatarCreatorConfig } from '@readyplayerme/react-avatar-creator';

interface Props {
  onAvatarExported: (url: string) => void;
  onClose: () => void;
}

const config: AvatarCreatorConfig = {
  clearCache: false,
  bodyType: 'fullbody',
  quickStart: false,
  language: 'en',
};

export default function RPMAvatarCreator({ onAvatarExported, onClose }: Props) {
  const handleOnAvatarExported = (event: any) => {
    // The event returns the URL of the GLB file
    const url = event.data.url;
    onAvatarExported(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="relative w-full h-full md:w-[90%] md:h-[90%] bg-white md:rounded-2xl overflow-hidden shadow-2xl">
        
        {/* Close Button */}
        <button 
            onClick={onClose}
            className="absolute top-4 right-4 z-50 bg-white/10 hover:bg-white/20 text-white p-2 rounded-full backdrop-blur-md transition-all"
        >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        {/* The Ready Player Me Editor */}
        <AvatarCreator 
          subdomain="demo" 
          config={config} 
          style={{ width: '100%', height: '100%', border: 'none' }} 
          onAvatarExported={handleOnAvatarExported} 
        />
      </div>
    </div>
  );
}