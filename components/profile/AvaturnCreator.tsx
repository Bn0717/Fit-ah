// components/profile/AvaturnCreator.tsx - Not use in latest development, but keep for reference
'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  onAvatarExported: (data: { url: string; animationName?: string }) => void;
  onClose: () => void;
}

export default function AvaturnCreator({ onAvatarExported, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Initializing Avaturn...');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    // Clear previous iframe if any
    container.innerHTML = '';
    
    const iframe = document.createElement('iframe');
    iframe.src = "https://fitcheckk.avaturn.dev"; // Your subdomain
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.allow = "camera *; microphone *; clipboard-write";
    container.appendChild(iframe);

    const handleMessage = (event: MessageEvent) => {
      // Security check: ensure the event comes from Avaturn if possible
      // But for development, we just parse the data
      
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return; }
      }

      if (data?.source !== 'avaturn') return;

      switch (data.eventName) {
        case 'v2.avatar.exported':
          console.log("✅ Avaturn Export:", data.data);
          setStatus('Exporting avatar...');
          
          onAvatarExported({
            url: data.data.url,
            // If Avaturn doesn't send an animation name, we let User3DModel handle the default
            animationName: undefined 
          });
          break;

        case 'v2.avatar.created':
          setStatus('Avatar created! Preparing download...');
          break;
          
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onAvatarExported]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1957]/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-6xl h-[85vh] bg-black rounded-3xl overflow-hidden shadow-2xl border-4 border-[#FFDBD1]">
        
        {/* Header Bar */}
        <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/80 to-transparent z-10 pointer-events-none" />

        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 z-20 bg-white/10 hover:bg-white/20 text-white w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-xl transition-all border border-white/10"
        >
          ✕
        </button>

        <div className="absolute top-4 left-6 z-20 bg-[#0B1957]/80 backdrop-blur-xl px-4 py-2 rounded-lg border border-white/10">
          <p className="text-white text-xs font-bold tracking-wide uppercase">{status}</p>
        </div>

        <div ref={containerRef} className="w-full h-full bg-[#1a1a1a]" />
      </div>
    </div>
  );
}