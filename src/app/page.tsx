'use client';

import { useWorldpadStore } from '@/lib/store';
import { useDerivConnection } from '@/hooks/use-deriv-connection';
import { LandingSection } from '@/components/worldpad/landing';
import { BotBuilder } from '@/components/worldpad/bot-builder';
import { AnalysisTool } from '@/components/worldpad/analysis-tool';
import { ManualTrader } from '@/components/worldpad/manual-trader';
import { AutoTrader } from '@/components/worldpad/auto-trader';
import { FreeBots } from '@/components/worldpad/free-bots';
import { CopyTrader } from '@/components/worldpad/copy-trader';
import { ComingSoon } from '@/components/worldpad/coming-soon';
import { Charts } from '@/components/worldpad/charts';
import { RiskCalculator } from '@/components/worldpad/risk-calculator';
import { StrategyPro } from '@/components/worldpad/strategy-pro';
import { Speedbot } from '@/components/worldpad/speedbot';
import { BulkTrader } from '@/components/worldpad/bulk-trader';
import { AISoftware } from '@/components/worldpad/ai-software';
import { AuthModal } from '@/components/worldpad/auth-modal';
import {
  Bot, Zap, Settings, Gauge, Brain,
  ScanSearch, Hand, Layers, LineChart,
  Users, Shield, Menu, X, DollarSign, Key,
} from 'lucide-react';
import { useState } from 'react';

const TABS = [
  { id: 'bot-builder', label: 'Bot Builder', icon: Bot },
  { id: 'free-bots', label: 'Free Bots', icon: Zap },
  { id: 'strategy-pro', label: 'Strategy Pro', icon: Settings },
  { id: 'speedbot', label: 'Speedbot', icon: Gauge },
  { id: 'ai-software', label: 'AI Software', icon: Brain },
  { id: 'auto-trader', label: 'Auto Trader', icon: ScanSearch },
  { id: 'analysis-tool', label: 'Analysis Tool', icon: Hand },
  { id: 'manual-trader', label: 'Manual Trader', icon: Layers },
  { id: 'bulk-trader', label: 'Bulk Trader', icon: Layers },
  { id: 'charts', label: 'Charts', icon: LineChart },
  { id: 'copy-trader', label: 'Copy Trader', icon: Users },
  { id: 'risk-calculator', label: 'Risk Calc', icon: Shield },
];

export default function WorldpadPage() {
  const { activeTab, setActiveTab, balance, isConnected, isConnecting, isAuthorized, accountMode } = useWorldpadStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  // Connect to Deriv WebSocket for live tick data
  useDerivConnection();

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'landing': return <LandingSection />;
      case 'bot-builder': return <BotBuilder />;
      case 'free-bots': return <FreeBots />;
      case 'analysis-tool': return <AnalysisTool />;
      case 'manual-trader': return <ManualTrader />;
      case 'auto-trader': return <AutoTrader />;
      case 'charts': return <Charts />;
      case 'risk-calculator': return <RiskCalculator />;
      case 'strategy-pro': return <StrategyPro />;
      case 'speedbot': return <Speedbot />;
      case 'bulk-trader': return <BulkTrader />;
      case 'ai-software': return <AISoftware />;
      case 'copy-trader': return <CopyTrader />;
      default:
        const tab = TABS.find(t => t.id === activeTab);
        return <ComingSoon title={tab?.label || activeTab} />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Top Navigation Bar */}
      <header
        className="sticky top-0 z-50"
        style={{
          background: 'rgba(13, 17, 23, 0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Gradient accent line at very top */}
        <div
          className="h-[1px]"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(0,212,170,0.4), rgba(224,64,251,0.4), transparent)',
          }}
        />

        {/* Main nav row */}
        <div className="flex items-center h-[52px] px-3 gap-2">
          {/* Logo with glow */}
          <button
            onClick={() => handleTabChange('landing')}
            className="flex items-center gap-0.5 shrink-0 mr-2 group"
          >
            <span
              className="text-base font-black tracking-tight transition-all"
              style={{
                color: '#00d4aa',
                textShadow: '0 0 12px rgba(0, 212, 170, 0.4)',
              }}
            >WORLD</span>
            <span
              className="text-base font-black tracking-tight transition-all"
              style={{
                color: '#e040fb',
                textShadow: '0 0 12px rgba(224, 64, 251, 0.4)',
              }}
            >PAD</span>
          </button>

          {/* Desktop tabs */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-hide">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`relative px-3 py-2 text-[11px] font-semibold whitespace-nowrap rounded-md transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'text-[#00d4aa] bg-[rgba(0,212,170,0.08)]'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-[rgba(255,255,255,0.03)]'
                }`}
                style={activeTab === tab.id ? {
                  textShadow: '0 0 8px rgba(0, 212, 170, 0.5)',
                } : {}}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div
                    className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                    style={{
                      background: 'linear-gradient(90deg, #00d4aa, #e040fb)',
                      boxShadow: '0 0 8px rgba(0, 212, 170, 0.6)',
                    }}
                  />
                )}
              </button>
            ))}
          </nav>

          {/* Right side: Balance + Mobile Menu */}
          <div className="flex items-center gap-3 ml-auto">
            {/* Balance pill */}
            <div
              className="flex items-center gap-2 px-2.5 py-1 rounded-full"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <DollarSign className="w-3.5 h-3.5" style={{ color: '#00d4aa' }} />
              <span className="text-xs font-mono font-bold text-white" style={{ textShadow: '0 0 8px rgba(255,255,255,0.3)' }}>{balance.toFixed(2)}</span>
            </div>

            {/* Auth button */}
            <button
              onClick={() => setAuthOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-200 hover:border-[rgba(255,255,255,0.2)]"
              style={{
                background: isAuthorized ? 'rgba(0,212,170,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isAuthorized ? 'rgba(0,212,170,0.2)' : 'rgba(255,255,255,0.06)'}`,
              }}
            >
              <Key className="w-3.5 h-3.5" style={{ color: isAuthorized ? (accountMode === 'real' ? '#ef4444' : '#00d4aa') : '#7d8590' }} />
              <span className={`text-[10px] font-bold hidden sm:inline ${isAuthorized ? (accountMode === 'real' ? 'text-[#ef4444]' : 'text-[#00d4aa]') : 'text-gray-500'}`}>{isAuthorized ? (accountMode === 'real' ? 'REAL' : 'DEMO') : 'LOGIN'}</span>
            </button>

            {/* Connection status dot with glow */}
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                isConnected ? 'bg-green-500 animate-wp-pulse' : isConnecting ? 'bg-yellow-500 animate-wp-pulse' : 'bg-red-500'
              }`} style={isConnected ? {
                boxShadow: '0 0 8px rgba(34, 197, 94, 0.6)',
              } : isConnecting ? {
                boxShadow: '0 0 8px rgba(234, 179, 8, 0.6)',
              } : {
                boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
              }} />
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-gray-400 hover:text-white transition-colors"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-[rgba(255,255,255,0.06)] max-h-[60vh] overflow-y-auto wp-scroll" style={{
            background: 'rgba(22, 27, 34, 0.95)',
            backdropFilter: 'blur(16px)',
          }}>
            <div className="grid grid-cols-2 gap-1 p-3">
              <button
                onClick={() => handleTabChange('landing')}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors text-left ${
                  activeTab === 'landing' ? 'bg-[rgba(0,212,170,0.08)] text-[#00d4aa]' : 'text-gray-400 hover:text-white hover:bg-[rgba(255,255,255,0.03)]'
                }`}
              >
                <div className="w-5 h-5 rounded" style={{ background: 'linear-gradient(135deg, #00d4aa, #e040fb)' }} />
                Home
              </button>
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors text-left ${
                    activeTab === tab.id ? 'bg-[rgba(0,212,170,0.08)] text-[#00d4aa]' : 'text-gray-400 hover:text-white hover:bg-[rgba(255,255,255,0.03)]'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderContent()}
      </main>

      {/* Auth Modal */}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
