'use client';

import { useWorldpadStore } from '@/lib/store';
import { BarChart3, Zap, Users, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

const SYMBOLS = ['R_100', 'R_10', 'R_25', 'R_50', 'R_75', '1HZ100V', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V'];
const SYMBOL_LABELS: Record<string, string> = {
  R_100: 'Volatility 100',
  R_10: 'Volatility 10',
  R_25: 'Volatility 25',
  R_50: 'Volatility 50',
  R_75: 'Volatility 75',
  '1HZ100V': 'Volatility 100 (1s)',
  '1HZ10V': 'Volatility 10 (1s)',
  '1HZ25V': 'Volatility 25 (1s)',
  '1HZ50V': 'Volatility 50 (1s)',
  '1HZ75V': 'Volatility 75 (1s)',
};

export function LandingSection() {
  const { balance, isConnecting, isConnected, setActiveTab, setActiveMarket, activeMarket, livePrice, currentDigit, tickCount } = useWorldpadStore();

  const features = [
    { icon: BarChart3, title: 'Advanced Charts', desc: 'Real-time digit analysis with probability grids', gradient: 'from-[#00d4aa] to-[#00b8a9]', action: 'analysis-tool' as const },
    { icon: Zap, title: 'Trading Bots', desc: 'Build and deploy automated digit strategies', gradient: 'from-[#ff6b35] to-[#f59e0b]', action: 'bot-builder' as const },
    { icon: Users, title: 'Copy Trading', desc: 'Follow top performers and mirror their trades', gradient: 'from-[#e040fb] to-[#d946ef]', action: 'copy-trader' as const },
  ];

  return (
    <div className="min-h-[calc(100vh-52px)] flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden">
      {/* Animated mesh gradient background */}
      <div className="absolute inset-0 wp-animated-mesh" />

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 wp-grid-bg opacity-50" />

      {/* Dot texture */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `radial-gradient(circle at 25% 25%, #00d4aa 1px, transparent 1px),
          radial-gradient(circle at 75% 75%, #e040fb 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
      }} />

      {/* Decorative glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full opacity-[0.07] blur-[80px] animate-float" style={{ background: '#00d4aa' }} />
      <div className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full opacity-[0.05] blur-[60px] animate-float" style={{ background: '#e040fb', animationDelay: '2s' }} />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 flex flex-col items-center gap-6 max-w-lg w-full"
      >
        {/* Logo with glow */}
        <div className="flex items-center gap-1 select-none">
          <span
            className="text-4xl sm:text-5xl font-black tracking-tight animate-fade-in-up"
            style={{
              color: '#00d4aa',
              textShadow: '0 0 20px rgba(0, 212, 170, 0.5), 0 0 40px rgba(0, 212, 170, 0.2)',
            }}
          >WORLD</span>
          <span
            className="text-4xl sm:text-5xl font-black tracking-tight animate-fade-in-up"
            style={{
              color: '#e040fb',
              textShadow: '0 0 20px rgba(224, 64, 251, 0.5), 0 0 40px rgba(224, 64, 251, 0.2)',
              animationDelay: '0.1s',
            }}
          >PAD</span>
        </div>

        {/* Subtitle with refined typography */}
        <p className="text-sm tracking-[0.3em] text-gray-500 font-semibold uppercase" style={{ letterSpacing: '0.3em' }}>Trading Research Lab</p>

        {/* Live badge with glow */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{
          background: isConnected ? 'rgba(34, 197, 94, 0.08)' : isConnecting ? 'rgba(234, 179, 8, 0.08)' : 'rgba(239, 68, 68, 0.08)',
          border: `1px solid ${isConnected ? 'rgba(34,197,94,0.2)' : isConnecting ? 'rgba(234,179,8,0.2)' : 'rgba(239,68,68,0.2)'}`,
        }}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-wp-pulse' : isConnecting ? 'bg-yellow-500 animate-wp-pulse' : 'bg-red-500'}`} style={isConnected ? {
            boxShadow: '0 0 8px rgba(34, 197, 94, 0.8)',
          } : {}} />
          <span className={`text-xs font-bold tracking-wider ${isConnected ? 'text-green-400' : isConnecting ? 'text-yellow-400' : 'text-red-400'}`} style={isConnected ? {
            textShadow: '0 0 8px rgba(34, 197, 94, 0.5)',
          } : {}}>
            {isConnected ? 'LIVE' : isConnecting ? 'CONNECTING' : 'OFFLINE'}
          </span>
        </div>

        {/* Progress bar with gradient and glow */}
        {isConnecting && (
          <div className="w-64 h-1.5 rounded-full overflow-hidden" style={{
            background: 'rgba(255,255,255,0.04)',
            boxShadow: '0 0 12px rgba(0, 212, 170, 0.1)',
          }}>
            <div
              className="h-full rounded-full animate-wp-loading"
              style={{
                background: 'linear-gradient(90deg, #00d4aa, #e040fb, #00d4aa)',
                backgroundSize: '200% 100%',
                boxShadow: '0 0 12px rgba(0, 212, 170, 0.4)',
              }}
            />
          </div>
        )}

        {isConnecting && !isConnected && (
          <p className="text-xs text-gray-500 animate-pulse">Connecting to Volatility Markets...</p>
        )}

        {/* Live data strip */}
        {isConnected && tickCount > 0 && (
          <div className="flex items-center gap-6 px-5 py-3 rounded-xl" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Price</span>
              <span className="text-lg font-mono font-bold" style={{
                color: '#00d4aa',
                textShadow: '0 0 12px rgba(0,212,170,0.5)',
              }}>{livePrice.toFixed(4)}</span>
            </div>
            <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Last Digit</span>
              <span className="text-3xl font-black font-mono" style={{
                color: '#e040fb',
                textShadow: '0 0 16px rgba(224,64,251,0.6)',
              }}>{currentDigit}</span>
            </div>
            <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Ticks</span>
              <span className="text-lg font-mono font-bold text-white">{tickCount.toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Market selector with polished pills */}
        {isConnected && (
          <div className="flex flex-col items-center gap-3 w-full">
            <p className="text-xs text-gray-500 tracking-wider uppercase font-medium">Select Market</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {SYMBOLS.map((s) => (
                <button
                  key={s}
                  onClick={() => setActiveMarket(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                    activeMarket === s
                      ? 'text-[#0d1117]'
                      : 'text-gray-300 hover:text-white'
                  }`}
                  style={activeMarket === s ? {
                    background: 'linear-gradient(135deg, #00d4aa, #00b8a9)',
                    boxShadow: '0 0 16px rgba(0, 212, 170, 0.4), 0 0 32px rgba(0, 212, 170, 0.15)',
                  } : {
                    background: 'rgba(0,0,0,0.6)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {SYMBOL_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feature cards with gradient borders and hover glow */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full mt-4">
          {features.map((f, i) => (
            <motion.button
              key={f.title}
              onClick={() => setActiveTab(f.action)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
              className="wp-glass-hover rounded-xl p-4 text-left group relative overflow-hidden"
            >
              {/* Top gradient accent line */}
              <div
                className="absolute top-0 left-0 right-0 h-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: `linear-gradient(90deg, transparent, ${f.gradient.includes('cyan') ? '#00d4aa' : f.gradient.includes('orange') ? '#ff6b35' : '#e040fb'}, transparent)` }}
              />
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 bg-gradient-to-br ${f.gradient} opacity-80 group-hover:opacity-100 transition-opacity`}>
                <f.icon className="w-4 h-4 text-[#0d1117]" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1 group-hover:text-white">{f.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
              <ArrowRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-[#00d4aa] mt-2 transition-all duration-200 group-hover:translate-x-1" />
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
