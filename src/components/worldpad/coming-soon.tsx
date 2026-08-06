'use client';

import { Construction } from 'lucide-react';

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="min-h-[calc(100vh-52px)] flex items-center justify-center px-4 relative">
      {/* Subtle background glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-96 h-96 rounded-full opacity-[0.04] blur-[80px]" style={{ background: 'linear-gradient(135deg, #00d4aa, #e040fb)' }} />
      </div>

      <div className="wp-animated-border rounded-2xl p-8 flex flex-col items-center gap-4 text-center relative z-10">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <Construction className="w-7 h-7 text-gray-400" style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.2))' }} />
        </div>
        <h2 className="text-lg font-bold text-white" style={{ letterSpacing: '0.02em' }}>{title}</h2>
        <p className="text-sm text-gray-500 max-w-sm leading-relaxed">This feature is currently under development. Check back soon for updates.</p>
        <div className="flex gap-2 mt-2">
          <div className="w-2 h-2 rounded-full bg-[#00d4aa] animate-wp-pulse" style={{ boxShadow: '0 0 8px rgba(0,212,170,0.6)' }} />
          <div className="w-2 h-2 rounded-full bg-[#e040fb] animate-wp-pulse" style={{ animationDelay: '0.5s', boxShadow: '0 0 8px rgba(224,64,251,0.6)' }} />
          <div className="w-2 h-2 rounded-full bg-[#ff6b35] animate-wp-pulse" style={{ animationDelay: '1s', boxShadow: '0 0 8px rgba(255,107,53,0.6)' }} />
        </div>
      </div>
    </div>
  );
}
