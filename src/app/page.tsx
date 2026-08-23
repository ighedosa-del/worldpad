"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useBotStore, getBot, destroyBot } from "@/lib/bot-v2/store";
import { DerivClient } from "@/lib/bot-v2/deriv-client";
import type { TickData } from "@/lib/bot-v2/types";
import type { AccountInfo } from "@/lib/bot-v2/types";
import {
  Brain, Play, Square, ArrowUpRight, ArrowDownRight,
  ChevronDown, Target, TrendingUp, Radio, LayoutDashboard,
  LineChart, Signal, Briefcase, Copy, ShieldAlert, Trophy, Settings,
  Bell, ChevronUp, Zap, Wifi, WifiOff, Lock, Key, RotateCcw
} from "lucide-react";

// ============================================================
// DATA
// ============================================================
const SYMBOLS = ["R_10", "R_25", "R_50", "R_75", "R_100"];
type MarketState = { sym: string; price: number; prevPrice: number; ch: number; ticks: TickData[] };
const initMarkets = (): MarketState[] => SYMBOLS.map(s => ({ sym: s, price: 0, prevPrice: 0, ch: 0, ticks: [] }));

const NAV = [
  { label: "DASHBOARD", Icon: LayoutDashboard, active: true },
  { label: "MARKETS", Icon: LineChart, active: false },
  { label: "SIGNALS", Icon: Signal, active: false },
  { label: "PORTFOLIO", Icon: Briefcase, active: false },
  { label: "TRADING", Icon: TrendingUp, active: false },
  { label: "AI ANALYSIS", Icon: Brain, active: false },
  { label: "COPY TRADING", Icon: Copy, active: false },
  { label: "RISK MANAGER", Icon: ShieldAlert, active: false },
  { label: "PERFORMANCE", Icon: Trophy, active: false },
  { label: "SETTINGS", Icon: Settings, active: false },
];

const TIME_BTNS = ["1S","5S","15S","1M","5M","15M","1H","4H","1D"];
const MONO = { fontFamily: '"JetBrains Mono", monospace' };

// ============================================================
// CHART
// ============================================================
function CandleChart({ data, emaLine }: { data: { o: number; h: number; l: number; c: number; v: number }[]; emaLine?: number[] }) {
  if (!data || data.length < 2) return <div className="w-full h-[220px] flex items-center justify-center text-[11px] text-[#5B6B86]">Waiting for live tick data...</div>;
  const maxP = Math.max(...data.map(d => d.h), ...(emaLine || []));
  const minP = Math.min(...data.map(d => d.l), ...(emaLine || []));
  const range = maxP - minP || 1;
  const y = (p: number) => 20 + (1 - (p - minP) / range) * 160;
  return (
    <svg viewBox="0 0 560 220" className="w-full h-[220px]">
      {[0,1,2,3,4].map(i => <line key={i} x1={0} x2={560} y1={20+i*40} y2={20+i*40} stroke="#0A1F15" strokeWidth={0.6} strokeDasharray="3 6" />)}
      {data.map((d, i) => {
        const x = 8 + i * 8.2 + 2; const bull = d.c >= d.o;
        const bt = y(Math.max(d.o, d.c)); const bb = y(Math.min(d.o, d.c));
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={bull ? "#10B981" : "#EF4444"} strokeWidth={1} opacity={0.9} />
            <rect x={x-2} y={bt} width={4} height={Math.max(2, bb - bt)} fill={bull ? "#10B981" : "#EF4444"} rx={0.5} />
          </g>
        );
      })}
      {emaLine && emaLine.length > 2 && <path d={`M 8 ${y(emaLine[0])} ${emaLine.map((v, i) => `L ${8+i*8.2} ${y(v)}`).join(" ")}`} fill="none" stroke="#FACC15" strokeWidth={1.2} opacity={0.9} />}
    </svg>
  );
}

// ============================================================
// EMPTY STATE HELPER
// ============================================================
function EmptyCell({ label }: { label: string }) {
  return <div className="flex items-center justify-center h-full text-[10px] text-[#3A4A60]">{label}</div>;
}

// ============================================================
// MAIN
// ============================================================
export default function Dashboard() {
  const [market, setMarket] = useState("R_75");
  const [tf, setTf] = useState("15S");
  const [time, setTime] = useState(new Date());
  const [mks, setMks] = useState<MarketState[]>(initMarkets);
  const [appIdInput, setAppIdInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [showConn, setShowConn] = useState(true);
  const [connStatus, setConnStatus] = useState<"idle"|"connecting"|"connected"|"error">("idle");
  const [connError, setConnError] = useState("");
  const [balance, setBalance] = useState(0);
  const [accountId, setAccountId] = useState("");
  const [accountList, setAccountList] = useState<AccountInfo[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [insights, setInsights] = useState<{t:string;type:string;msg:string;badge:string;bc:string}[]>([]);
   const [botStarting, setBotStarting] = useState(false);

  // Bot store state
  const storeConnected = useBotStore(s => s.connected);
  const storeRunning = useBotStore(s => s.running);
  const storePhase = useBotStore(s => s.phase);
  const storeStats = useBotStore(s => s.stats);
  const storeRankedMarkets = useBotStore(s => s.rankedMarkets);
  const storeMarketData = useBotStore(s => s.marketData);
  const storeTradeHistory = useBotStore(s => s.tradeHistory);
  const storeLogs = useBotStore(s => s.logs);
  const storeBalance = useBotStore(s => s.balance);
  const storeTicks = useBotStore(s => s.ticks);
  const storeGates = useBotStore(s => s.gates);
  const storeMarketFeatures = useBotStore(s => s.marketFeatures);
  const storeRobustnessStage = useBotStore(s => s.robustnessStage);

  const clientRef = useRef<DerivClient | null>(null);
  const tickBufRef = useRef<Map<string, TickData[]>>(new Map());
  const priceHistRef = useRef<Map<string, number[]>>(new Map());
  const unsubFns = useRef<(() => void)[]>([]);
  const botRef = useRef<any>(null);

  // Load saved credentials on mount + sync to store
  useEffect(() => {
    const savedAppId = localStorage.getItem("deriv-app-id");
    const savedToken = localStorage.getItem("deriv-token");
    if (savedAppId) { setAppIdInput(savedAppId); useBotStore.getState().setAppId(savedAppId); }
    if (savedToken) { setTokenInput(savedToken); useBotStore.getState().setToken(savedToken); }
  }, []);

  // Clock
  useEffect(() => { const iv = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(iv); }, []);

  // Build candles from real tick buffer
  const candles = useMemo(() => {
    const buf = tickBufRef.current.get(market);
    if (!buf || buf.length < 3) return [];
    const ticks = buf.slice(-256);
    const candleCount = 64;
    const perCandle = Math.max(1, Math.floor(ticks.length / candleCount));
    const result: { o: number; h: number; l: number; c: number; v: number }[] = [];
    for (let i = 0; i < candleCount; i++) {
      const start = i * perCandle;
      const end = Math.min(start + perCandle, ticks.length);
      const slice = ticks.slice(start, end);
      if (slice.length === 0) continue;
      const prices = slice.map(t => t.price);
      result.push({ o: prices[0], h: Math.max(...prices), l: Math.min(...prices), c: prices[prices.length - 1], v: slice.length });
    }
    return result;
  }, [market, mks]);

  // RSI from price history
  const rsi = useMemo(() => {
    const hist = priceHistRef.current.get(market);
    if (!hist || hist.length < 15) return 50;
    const prices = hist.slice(-15);
    let gains = 0, losses = 0;
    for (let i = 1; i < prices.length; i++) { const diff = prices[i] - prices[i-1]; if (diff > 0) gains += diff; else losses -= diff; }
    const avgGain = gains / 14; const avgLoss = losses / 14;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }, [market, mks]);

  // EMA for chart overlay
  const ema9 = useMemo(() => {
    const buf = tickBufRef.current.get(market);
    if (!buf || buf.length < 10) return [];
    const prices = buf.slice(-64).map(t => t.price);
    const k = 2 / 10; let ema = prices[0];
    return prices.map(p => { ema = p * k + ema * (1-k); return ema; });
  }, [market, mks]);

  // CONNECT / DISCONNECT
  const handleConnect = async () => {
    if (!appIdInput.trim() || !tokenInput.trim()) return;
    const appId = appIdInput.trim();
    const token = tokenInput.trim();
    setConnStatus("connecting");
    setConnError("");
    localStorage.setItem("deriv-app-id", appId);
    localStorage.setItem("deriv-token", token);

    try {
      unsubFns.current.forEach(fn => fn());
      unsubFns.current = [];
      if (clientRef.current) { clientRef.current.destroy(); clientRef.current = null; }

      const client = new DerivClient(appId);
      clientRef.current = client;

      const auth = await client.connect(token, selectedAccountId || undefined);
      setBalance(auth.balance);
      setAccountId(auth.loginid);
      setAccountList(auth.accountList || []);
      setSelectedAccountId(auth.loginid);
      setConnStatus("connected");

      // Subscribe to ticks for all symbols
      for (const sym of SYMBOLS) {
        tickBufRef.current.set(sym, []);
        priceHistRef.current.set(sym, []);
        const unsub = client.onTick(sym, (tick: TickData) => {
          setMks(prev => prev.map(mk => {
            if (mk.sym !== sym) return mk;
            const prev = mk.price || tick.price;
            const newPrice = tick.price;
            const isVol = sym.includes("VOL");
            const base = prev || (isVol ? 1 : 1000);
            const ch = base > 0 ? ((newPrice - base) / base) * 100 : 0;
            return { ...mk, price: newPrice, prevPrice: prev, ch };
          }));
          const buf = tickBufRef.current.get(sym) || [];
          buf.push(tick);
          if (buf.length > 512) buf.splice(0, buf.length - 512);
          tickBufRef.current.set(sym, buf);
          const hist = priceHistRef.current.get(sym) || [];
          hist.push(tick.price);
          if (hist.length > 200) hist.splice(0, hist.length - 200);
          priceHistRef.current.set(sym, hist);
          setMks(prev => [...prev]);
        });
        unsubFns.current.push(unsub);
      }

      const balUnsub = client.onBalance(data => setBalance(data.balance));
      unsubFns.current.push(balUnsub);
      const closeUnsub = client.onClose(() => {
        setConnStatus("error");
        setConnError("Connection lost. Reconnect needed.");
      });
      unsubFns.current.push(closeUnsub);

      // Sync appId + token to bot store so START BOT can use them
      useBotStore.getState().setAppId(appId);
      useBotStore.getState().setToken(token);

      setInsights([{ t: new Date().toTimeString().slice(0,5), type: "System", msg: `Connected to Deriv (${auth.isVirtual ? "Demo" : "Real"}) \u2014 Account ${auth.loginid}`, badge: "CONNECTED", bc: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30" }]);
    } catch (err: any) {
      setConnStatus("error");
      setConnError(err.message || "Connection failed");
    }
  };

  // SWITCH ACCOUNT
  const handleSwitchAccount = async (newAccountId: string) => {
    if (newAccountId === selectedAccountId) return;
    setSelectedAccountId(newAccountId);
    if (connStatus === "connected") {
      // Disconnect and reconnect with new account
      unsubFns.current.forEach(fn => fn());
      unsubFns.current = [];
      if (clientRef.current) { clientRef.current.destroy(); clientRef.current = null; }
      setConnStatus("idle");

      // Auto-reconnect with new account
      setTimeout(async () => {
        setConnStatus("connecting");
        try {
          const client = new DerivClient(appIdInput.trim());
          clientRef.current = client;
          const auth = await client.connect(tokenInput.trim(), newAccountId);
          setBalance(auth.balance);
          setAccountId(auth.loginid);
          setConnStatus("connected");
          for (const sym of SYMBOLS) {
            tickBufRef.current.set(sym, []);
            priceHistRef.current.set(sym, []);
            const unsub = client.onTick(sym, (tick: TickData) => {
              setMks(prev => prev.map(mk => {
                if (mk.sym !== sym) return mk;
                const prev = mk.price || tick.price;
                const isVol = sym.includes("VOL");
                const base = prev || (isVol ? 1 : 1000);
                return { ...mk, price: tick.price, prevPrice: prev, ch: base > 0 ? ((tick.price - base) / base) * 100 : 0 };
              }));
              const buf = tickBufRef.current.get(sym) || [];
              buf.push(tick);
              if (buf.length > 512) buf.splice(0, buf.length - 512);
              tickBufRef.current.set(sym, buf);
              const hist = priceHistRef.current.get(sym) || [];
              hist.push(tick.price);
              if (hist.length > 200) hist.splice(0, hist.length - 200);
              priceHistRef.current.set(sym, hist);
              setMks(prev => [...prev]);
            });
            unsubFns.current.push(unsub);
          }
          unsubFns.current.push(client.onBalance(data => setBalance(data.balance)));
          unsubFns.current.push(client.onClose(() => { setConnStatus("error"); setConnError("Connection lost."); }));
          useBotStore.getState().setAppId(appIdInput.trim());
      setInsights(prev => [{ t: new Date().toTimeString().slice(0,5), type: "System", msg: `Switched to ${auth.isVirtual ? "Demo" : "Real"} account ${auth.loginid}`, badge: "SWITCHED", bc: "bg-[#3B82F6]/15 text-[#60A5FA] border-[#3B82F6]/30" }, ...prev]);
        } catch (err: any) {
          setConnStatus("error");
          setConnError(err.message || "Account switch failed");
        }
      }, 300);
    }
  };

  const handleDisconnect = () => {
    // Stop bot if running
    if (botRef.current) {
      try { botRef.current.stop(); } catch {}
      botRef.current = null;
    }
    unsubFns.current.forEach(fn => fn());
    unsubFns.current = [];
    if (clientRef.current) { clientRef.current.destroy(); clientRef.current = null; }
    setConnStatus("idle"); setConnError(""); setAccountId(""); setAccountList([]);
    setMks(initMarkets()); tickBufRef.current.clear(); priceHistRef.current.clear();
  };

  // BOT START / STOP using real engine
  const handleBotStart = useCallback(() => {
    if (!clientRef.current?.isConnected) return;
    // Destroy any old bot instance to force fresh creation with current appId
    destroyBot();
    const bot = getBot();
    botRef.current = bot;
    setBotStarting(true);
    console.log('[Dashboard] Starting bot with appId:', useBotStore.getState().appId);
    bot.connect(tokenInput.trim(), selectedAccountId).then(() => {
      console.log('[Dashboard] Bot connected, starting...');
      bot.start();
      setBotStarting(false);
    }).catch((err: Error) => {
      console.error('[Dashboard] Bot start failed:', err);
      setInsights(prev => [{ t: new Date().toTimeString().slice(0,5), type: "Error", msg: `Bot start failed: ${err.message}`, badge: "ERROR", bc: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30" }, ...prev]);
      setBotStarting(false);
    });
  }, [selectedAccountId, tokenInput]);

  const handleBotStop = useCallback(() => {
    if (botRef.current) { botRef.current.stop(); }
    setBotStarting(false);
  }, []);

  const isConnected = connStatus === "connected";
  const hasPriceData = candles.length > 0;
  const activeMk = mks.find(m => m.sym === market);
  const currentPrice = activeMk?.price || 0;
  const utc = time.toUTCString().split(" ")[4] ?? "--:--:--";

  // Derived from real bot data
  const topMarket = storeRankedMarkets.length > 0 ? storeRankedMarkets[0] : null;
  const botSignal = topMarket?.signal || "";
  const botScore = topMarket?.score || 0;
  const botRegime = topMarket?.regime || "";
  const stats = storeStats;
  const hasStats = stats !== null && stats.totalTrades > 0;

  // Build probability meters from ranked markets
  const probMeters = useMemo(() => {
    if (storeRankedMarkets.length === 0) {
      return SYMBOLS.concat(["R_10"]).map(m => ({ m, s: "WAIT" as const, c: 0, col: "#EAB308" }));
    }
    return storeRankedMarkets.slice(0, 5).map(rm => {
      const isOver = rm.signal?.includes("OVER");
      const isUnder = rm.signal?.includes("UNDER");
      const s = isOver ? "BUY" as const : isUnder ? "SELL" as const : "WAIT" as const;
      const score = Math.min(100, Math.max(0, Math.round(rm.score || 0)));
      const col = s === "BUY" ? "#22C55E" : s === "SELL" ? "#EF4444" : "#EAB308";
      return { m: rm.symbol, s, c: score, col };
    });
  }, [storeRankedMarkets]);

  // Build score items from real data
  const scoreItems = useMemo(() => {
    if (!topMarket) return [{ l: "Score", v: 0, col: "#22C55E" }];
    const sc = Math.min(100, Math.round(topMarket.score || 0));
    return [
      { l: "Market Score", v: sc, col: sc > 60 ? "#22C55E" : sc > 30 ? "#EAB308" : "#EF4444" },
      { l: "EV", v: topMarket.ev ? parseFloat((topMarket.ev * 100).toFixed(1)) : 0, col: (topMarket.ev || 0) > 0 ? "#22C55E" : "#EF4444" },
      { l: "Ticks", v: storeTicks, col: "#22D3EE" },
      { l: "Backtest", v: topMarket.backtestGrade === "A" ? 95 : topMarket.backtestGrade === "B" ? 75 : topMarket.backtestGrade === "C" ? 50 : 0, col: "#8B5CF6" },
      { l: "Regime", v: topMarket.regime === "TRENDING" ? 80 : topMarket.regime === "RANGING" ? 50 : 30, col: "#EC4899" },
    ];
  }, [topMarket, storeTicks]);

  // Recent trade insights (from store logs + engine insights)
  const displayInsights = useMemo(() => {
    // Engine pushes error insights as { level, text }
    if (insights.length > 0) {
      return insights.map((ins, i) => {
        const isError = ins.level === 'error';
        const badge = isError ? "ERROR" : "INFO";
        const bc = isError
          ? "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30"
          : "bg-[#065F46]/60 text-[#94A3B8] border-[#047857]";
        return { t: "--:--", type: "Bot", msg: ins.text.slice(0, 100), badge, bc };
      });
    }
    // Show recent bot logs as insights
    if (storeLogs.length > 0) {
      return storeLogs.slice(-8).reverse().map(log => {
        const logLower = log.toLowerCase();
        const isWin = log.includes("WIN") || log.includes("+$");
        const isLoss = log.includes("LOSS");
        const isError = logLower.includes("error") || logLower.includes("failed") || logLower.includes("!!!");
        const timeMatch = log.match(/\[(\d{2}:\d{2}:\d{2})\]/);
        const t = timeMatch ? timeMatch[1] : "--:--";
        let badge = "LOG", bc = "bg-[#065F46]/60 text-[#94A3B8] border-[#047857]";
        if (isWin) { badge = "WIN"; bc = "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30"; }
        else if (isLoss) { badge = "LOSS"; bc = "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30"; }
        else if (isError) { badge = "ERROR"; bc = "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30"; }
        const msg = log.replace(/\[\d{2}:\d{2}:\d{2}\]\s*/, "");
        return { t, type: "Bot", msg: msg.slice(0, 100), badge, bc };
      });
    }
    return [];
  }, [insights, storeLogs]);

  return (
    <div className="min-h-screen w-full text-white relative overflow-hidden selection:bg-[#10B981]/30" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Background image — transparent panels overlay */}
      <div className="absolute inset-0 z-0" style={{ backgroundImage: "url('/bg-metallic.png')", backgroundSize: "cover", backgroundPosition: "center center", backgroundRepeat: "no-repeat" }} />
      {/* Subtle dark overlay so text remains readable */}
      <div className="absolute inset-0 z-[1] bg-[#020D08]/18" />

      <div className="relative z-10 min-w-[1440px] xl:min-w-0 w-full flex flex-col h-screen">

        {/* ===== HEADER ===== */}
        <header className="h-[62px] shrink-0 flex items-center justify-between px-4 border-b border-[#065F46]/60 bg-[#020D08]/30 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#071F14] border border-[#10B981]/40 flex items-center justify-center shadow-[0_0_18px_rgba(16,185,129,0.35)]">
              <Brain className="w-5 h-5 text-cyan-300" />
            </div>
            <div className="leading-none">
              <span className="font-extrabold tracking-[0.08em] text-[13px]">LZ-N ULTIMATE BRAIN</span>
              <div className="text-[9px] tracking-[0.18em] text-[#6B7A90] font-medium mt-[2px]">QUANTUM AI TRADING SYSTEM</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mks.map(mk => {
              const act = mk.sym === market; const up = mk.ch >= 0;
              return (
                <button key={mk.sym} onClick={() => setMarket(mk.sym)} className={`h-[32px] px-3 rounded-full flex items-center gap-2 border text-[11px] transition-all ${act ? "bg-[#0A2E1F] border-[#047857] shadow-[0_0_12px_rgba(16,185,129,0.25)]" : "bg-[#051510] border-[#065F46]/60 hover:bg-[#0D1D35]"}`}>
                  <Radio className="w-3 h-3 text-cyan-300" />
                  <span className="font-bold text-white">{mk.sym}</span>
                  <span className="text-white/90">{mk.price > 0 ? (mk.sym.includes("VOL") ? mk.price.toFixed(4) : mk.price.toFixed(2)) : "--"}</span>
                  <span className={`text-[10px] font-bold flex items-center ${up ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                    {up ? <ChevronUp className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {mk.price > 0 ? `${up ? "+" : ""}${mk.ch.toFixed(2)}%` : "--"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right leading-none">
              <div className="text-[9px] tracking-widest text-[#6B7A90]">SERVER TIME</div>
              <div className="font-bold text-[13px] mt-0.5" style={MONO}>{utc} <span className="font-normal text-[10px]">UTC</span></div>
            </div>
            <div className="h-8 w-px bg-[#065F46]/50 mx-1" />
            <div className={`flex items-center gap-1.5 bg-[#051510] border rounded-full px-2.5 h-[30px] ${isConnected ? "border-[#22C55E]/40" : "border-[#065F46]/60"}`}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-[#22C55E] shadow-[0_0_8px_#22C55E] animate-pulse" : "bg-[#5B6B86]"}`} />
              <span className={`text-[10px] font-bold tracking-widest ${isConnected ? "text-[#22C55E]" : "text-[#5B6B86]"}`}>{isConnected ? "LIVE" : "OFFLINE"}</span>
            </div>
            <button className="w-8 h-8 rounded-lg bg-[#051510] border border-[#065F46]/60 flex items-center justify-center hover:bg-[#0D1D35]"><Bell className="w-4 h-4 text-[#94A3B8]" /></button>
            <button className="w-8 h-8 rounded-lg bg-[#051510] border border-[#065F46]/60 flex items-center justify-center hover:bg-[#0D1D35]"><Settings className="w-4 h-4 text-[#94A3B8]" /></button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 p-[1.5px] shadow-[0_0_14px_rgba(59,130,246,0.6)]">
              <div className="w-full h-full rounded-full bg-[#0A1930] flex items-center justify-center"><Brain className="w-4 h-4 text-cyan-200" /></div>
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">

          {/* ===== SIDEBAR ===== */}
          <aside className="w-[200px] shrink-0 bg-[#020D08]/15 border-r border-[#065F46]/25 flex flex-col backdrop-blur-md overflow-y-auto">
            <div className="p-2.5 space-y-2.5 shrink-0">
              {/* CONNECTION PANEL */}
              <div className="panel rounded-xl overflow-hidden">
                <button onClick={() => setShowConn(!showConn)} className="w-full p-3 flex items-center justify-between text-[9px] tracking-widest text-[#6B7A90] font-bold hover:bg-white/[0.02] transition-colors">
                  <span className="flex items-center gap-1.5"><Key className="w-3 h-3" />CONNECTION</span>
                  <span className={`flex items-center gap-1 ${isConnected ? "text-[#22C55E]" : connStatus === "connecting" ? "text-[#EAB308]" : connStatus === "error" ? "text-[#EF4444]" : "text-[#6B7A90]"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shadow-[0_0_6px] inline-block ${isConnected ? "bg-[#22C55E] shadow-[#22C55E]" : connStatus === "connecting" ? "bg-[#EAB308] shadow-[#EAB308] animate-pulse" : connStatus === "error" ? "bg-[#EF4444] shadow-[#EF4444]" : "bg-[#6B7A90] shadow-[#6B7A86]"}`} />
                    {isConnected ? "CONNECTED" : connStatus === "connecting" ? "CONNECTING..." : connStatus === "error" ? "ERROR" : "DISCONNECTED"}
                  </span>
                </button>
                {showConn && (
                  <div className="px-3 pb-3 space-y-2 border-t border-[#065F46]/40 pt-2">
                    <div>
                      <div className="text-[8px] tracking-widest text-[#6B7A90] mb-1">DERIV APP ID</div>
                      <input type="text" placeholder="e.g. 341aJK71v75g15Vud3q6w" value={appIdInput} onChange={e => setAppIdInput(e.target.value)} disabled={connStatus === "connecting"} className="w-full h-7 bg-[#051510] border border-[#065F46]/60 rounded-lg px-2 text-[10px] text-white placeholder:text-[#3A4A60] focus:outline-none focus:border-[#10B981]/60 focus:shadow-[0_0_8px_rgba(16,185,129,0.2)] transition-all disabled:opacity-50" style={MONO} />
                    </div>
                    <div>
                      <div className="text-[8px] tracking-widest text-[#6B7A90] mb-1">AUTH TOKEN (PAT_)</div>
                      <input type="password" placeholder="PAT_xxxxxxxxxxxxx" value={tokenInput} onChange={e => setTokenInput(e.target.value)} disabled={connStatus === "connecting"} className="w-full h-7 bg-[#051510] border border-[#065F46]/60 rounded-lg px-2 text-[10px] text-white placeholder:text-[#3A4A60] focus:outline-none focus:border-[#10B981]/60 focus:shadow-[0_0_8px_rgba(16,185,129,0.2)] transition-all disabled:opacity-50" style={MONO} />
                    </div>

                    {/* ACCOUNT DROPDOWN — always show when connected */}
                    {isConnected && accountList.length >= 1 && (
                      <div>
                        <div className="text-[8px] tracking-widest text-[#6B7A90] mb-1">ACCOUNT</div>
                        {accountList.length > 1 ? (
                          <select value={selectedAccountId} onChange={e => handleSwitchAccount(e.target.value)} disabled={connStatus === "connecting"} className="w-full h-7 bg-[#051510] border border-[#065F46]/60 rounded-lg px-2 text-[10px] text-white focus:outline-none focus:border-[#10B981]/60 transition-all disabled:opacity-50" style={MONO}>
                            {accountList.map(acc => (
                              <option key={acc.loginid} value={acc.loginid}>
                                {acc.loginid} {acc.isVirtual ? "(DEMO)" : "(REAL)"} {acc.balance !== undefined ? `$${parseFloat(String(acc.balance)).toFixed(2)}` : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="w-full h-7 bg-[#051510] border border-[#065F46]/60 rounded-lg px-2 text-[10px] text-white flex items-center justify-between" style={MONO}>
                            <span>{accountList[0]?.loginid || accountId}</span>
                            <span className={accountList[0]?.isVirtual ? "text-[#EAB308]" : "text-[#22C55E]"}>{accountList[0]?.isVirtual ? "DEMO" : "REAL"}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {!isConnected && (
                      <button onClick={handleConnect} disabled={!appIdInput.trim() || !tokenInput.trim() || connStatus === "connecting"} className={`w-full h-7 rounded-lg text-[10px] font-bold tracking-widest flex items-center justify-center gap-1.5 transition-all ${appIdInput.trim() && tokenInput.trim() ? "bg-gradient-to-r from-[#047857] to-[#10B981] text-white shadow-[0_0_12px_rgba(16,185,129,0.40)] hover:shadow-[0_0_20px_rgba(16,185,129,0.60)]" : "bg-[#071A12] text-[#3A4A60] cursor-not-allowed"}`}>
                        {connStatus === "connecting" ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Lock className="w-3 h-3" />}
                        {connStatus === "connecting" ? "CONNECTING..." : "CONNECT"}
                      </button>
                    )}
                    {isConnected && (
                      <button onClick={handleDisconnect} className="w-full h-7 rounded-lg text-[10px] font-bold tracking-widest flex items-center justify-center gap-1.5 bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/25 transition-all">
                        <WifiOff className="w-3 h-3" />DISCONNECT
                      </button>
                    )}
                    {isConnected && (
                      <div className="text-[9px] space-y-1" style={MONO}>
                        <div className="flex justify-between"><span className="text-[#94A3B8]">Account</span><span className="text-white">{accountId}</span></div>
                        <div className="flex justify-between"><span className="text-[#94A3B8]">Balance</span><span className="text-[#22C55E] font-bold">${balance.toFixed(2)}</span></div>
                      </div>
                    )}
                    {connError && <div className="text-[8px] text-[#EF4444] leading-tight break-all" style={MONO}>{connError}</div>}
                    <div className="h-[2px] bg-[#071A12] rounded-full overflow-hidden"><div className={`h-full transition-all duration-700 ${isConnected ? "w-full bg-[#22C55E] shadow-[0_0_8px_#22C55E]" : "w-0"}`} /></div>
                  </div>
                )}
              </div>

              {/* BOT ENGINE PANEL — with 4D LUCAS mascot */}
              <div className="panel rounded-xl p-3 pb-2 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] tracking-[0.18em] font-bold text-[#A78BFA]">QUANTUM ENGINE</span>
                  <span className={`text-[9px] font-bold tracking-widest ${storeRunning ? "text-[#22C55E]" : storePhase === "scanning" || storePhase === "collecting" ? "text-[#EAB308]" : "text-[#5B6B86]"}`}>
                    {storeRunning ? "ACTIVE" : storePhase === "scanning" ? "SCANNING" : storePhase === "collecting" ? "LEARNING" : "IDLE"}
                  </span>
                </div>
                <div className="relative h-[90px] mt-1 flex items-center justify-center" style={{ perspective: '900px' }}>
                  <div className="bot-aura" />
                  <div className="bot-wrap">
                    <img src="/lucas.png" alt="LUCAS" className="lucas-bot" />
                    <span className="lucas-eye e1" />
                    <span className="lucas-eye e2" />
                    <span className="lucas-bolt" />
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between text-[9px]" style={MONO}>
                  <span className="text-[#6B7A90]">AI TICKS</span>
                  <span className="text-cyan-300 font-bold">{storeTicks > 0 ? storeTicks.toLocaleString() : "--"}</span>
                </div>
                <div className="mt-1.5 h-[3px] bg-[#071A12] rounded-full overflow-hidden">
                  <div className={`h-full bg-gradient-to-r from-cyan-400 to-blue-400 shadow-[0_0_8px_cyan] transition-all duration-500`} style={{ width: `${Math.min(100, storeTicks / 50)}%` }} />
                </div>
                {/* BOT START / STOP */}
                <div className="mt-2 flex gap-1.5">
                  {!storeRunning && isConnected && (
                    <button onClick={handleBotStart} disabled={botStarting} className={`flex-1 h-6 rounded-lg text-[9px] font-bold tracking-widest flex items-center justify-center gap-1 transition-all ${botStarting ? "bg-[#065F46] text-[#5B6B86]" : "bg-[#22C55E]/15 border border-[#22C55E]/40 text-[#22C55E] hover:bg-[#22C55E]/25"}`}>
                      {botStarting ? <div className="w-2.5 h-2.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play className="w-3 h-3" />}
                      {botStarting ? "LOADING..." : "START BOT"}
                    </button>
                  )}
                  {storeRunning && (
                    <button onClick={handleBotStop} className="flex-1 h-6 rounded-lg text-[9px] font-bold tracking-widest flex items-center justify-center gap-1 bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/25 transition-all">
                      <Square className="w-3 h-3" />STOP BOT
                    </button>
                  )}
                  {!isConnected && (
                    <div className="flex-1 h-6 rounded-lg bg-[#071A12] text-[#3A4A60] text-[9px] font-bold tracking-widest flex items-center justify-center">CONNECT FIRST</div>
                  )}
                </div>
              </div>
            </div>
            {/* NAV — below connection/engine so they're always visible first */}
            <nav className="px-2.5 pb-2.5 space-y-[2px]">
              {NAV.map(n => (
                <button key={n.label} className={`w-full flex items-center gap-2.5 px-3 h-[34px] rounded-lg text-[10.5px] tracking-[0.06em] font-semibold transition-all ${n.active ? "bg-[#0A2E1F]/80 text-white border border-[#10B981]/50 shadow-[0_0_18px_rgba(16,185,129,0.35),inset_0_0_0_1px_rgba(16,185,129,0.15)]" : "text-[#94A3B8] hover:text-white hover:bg-[#0E1C36] border border-transparent"}`}>
                  <n.Icon className={`w-[15px] h-[15px] ${n.active ? "text-[#A78BFA]" : "text-[#5B6B86]"}`} />
                  {n.label}
                </button>
              ))}
            </nav>
          </aside>

          {/* ===== MAIN ===== */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3 bg-transparent">

            {/* ROW 1 */}
            <div className="grid grid-cols-12 gap-3 h-[380px]">
              {/* AI SIGNAL — real data from bot */}
              <div className="col-span-2 panel panel-glow rounded-xl p-3 flex flex-col">
                <div className="flex items-center justify-between"><span className="text-[10px] tracking-[0.18em] font-bold text-[#7FB0D0]">AI QUANTUM SIGNAL</span><span className={`w-2 h-2 rounded-full ${topMarket ? "bg-[#22C55E] shadow-[0_0_8px_#22C55E]" : "bg-[#5B6B86]"}`} /></div>
                <div className="flex-1 flex flex-col items-center justify-center mt-2">
                  <div className="relative w-[132px] h-[132px] flex items-center justify-center">
                    <div className={`absolute inset-0 rounded-full border shadow-[0_0_24px_rgba(16,185,129,0.35)] ${topMarket ? "border-[#10B981]/40" : "border-[#065F46]/40"}`} style={{ animation: "pulseRing 2.2s ease-in-out infinite" }} />
                    <div className={`absolute inset-[10px] rounded-full border ${topMarket ? "border-cyan-400/30 shadow-[0_0_18px_rgba(34,211,238,0.3)]" : "border-[#065F46]/30"}`} style={{ animation: "pulseRing 2.2s ease-in-out infinite 0.3s" }} />
                    <div className="absolute inset-[22px] rounded-full border border-[#065F46]/40" />
                    <div className="absolute inset-[28px] rounded-full bg-[#081830] border border-[#065F46]/60 flex flex-col items-center justify-center">
                      {topMarket ? (
                        <>
                          <div className={`font-extrabold text-[22px] tracking-widest leading-none drop-shadow-[0_0_12px] ${botSignal.includes("OVER") ? "text-[#00FF88]" : botSignal.includes("UNDER") ? "text-[#EF4444]" : "text-[#EAB308]"}`} style={botSignal.includes("OVER") ? { textShadow: "0 0 12px #00FF88" } : botSignal.includes("UNDER") ? { textShadow: "0 0 12px #EF4444" } : {}}>
                            {botSignal.includes("OVER") ? "OVER" : botSignal.includes("UNDER") ? "UNDER" : "WAIT"}
                          </div>
                          <div className="text-[10px] mt-1 text-cyan-300" style={MONO}>SCORE</div>
                          <div className="text-[16px] font-bold text-cyan-200 leading-none" style={MONO}>{botScore > 0 ? botScore.toFixed(0) : "--"}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-[#5B6B86] font-bold text-[14px] tracking-widest leading-none">NO SIGNAL</div>
                          <div className="text-[10px] mt-1 text-[#5B6B86]" style={MONO}>{!isConnected ? "CONNECT" : "START BOT"}</div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="w-full mt-4 space-y-1">
                    <div className="text-[9px] tracking-widest text-[#6B7A90] font-bold">TARGET MARKET</div>
                    <div className="text-[10px] leading-[1.35] text-[#AAB8CC]">
                      {topMarket ? (
                        <>
                          <div className="flex gap-1.5"><span className="text-[#5B6B86]">\u2022</span> {topMarket.symbol} \u2014 {topMarket.name}</div>
                          <div className="flex gap-1.5"><span className="text-[#5B6B86]">\u2022</span> {botSignal || "Scanning..."}</div>
                          <div className="flex gap-1.5"><span className="text-[#5B6B86]">\u2022</span> Regime: {topMarket.regime || "Analyzing"}</div>
                          <div className="flex gap-1.5"><span className="text-[#5B6B86]">\u2022</span> EV: {topMarket.ev !== undefined ? (topMarket.ev * 100).toFixed(1) + "%" : "--"}</div>
                        </>
                      ) : (
                        <div className="flex gap-1.5"><span className="text-[#5B6B86]">\u2022</span> {isConnected ? "Bot must be running to generate signals" : "Connect to Deriv to begin"}</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* PROB METERS — from ranked markets */}
              <div className="col-span-3 panel rounded-xl p-3 flex flex-col">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.14em] font-bold text-[#7FB0D0]">CONTRACT PROBABILITY</span>
                  <span className="text-[9px] px-2 h-4 rounded-full bg-[#7C3AED]/20 text-[#A78BFA] border border-[#7C3AED]/30 flex items-center" style={MONO}>{storeRankedMarkets.length > 0 ? storeRankedMarkets.length : SYMBOLS.length + 1} MARKETS</span>
                </div>
                <div className="mt-3 flex-1 space-y-2.5">
                  {probMeters.map(p => (
                    <div key={p.m} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-white w-12" style={MONO}>{p.m}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${p.s === "BUY" ? "bg-[#22C55E]/20 text-[#22C55E]" : p.s === "SELL" ? "bg-[#EF4444]/20 text-[#EF4444]" : "bg-[#EAB308]/20 text-[#EAB308]"}`}>{p.s}</span>
                      <span className="text-white" style={MONO}>{p.c}%</span>
                      <div className="flex-1 h-[4px] bg-[#071A12] rounded-full overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${p.c}%`, background: p.col }} /></div>
                    </div>
                  ))}
                </div>
              </div>

              {/* CHART — already real data */}
              <div className="col-span-7 panel rounded-xl flex flex-col overflow-hidden">
                <div className="h-[34px] flex items-center justify-between px-3 border-b border-[#065F46]/40 shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-bold tracking-[0.12em]">MARKET GRAPH \u2014 {market}</span>
                    {isConnected && <span className="text-[10px] px-2 h-5 rounded-full bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30 flex items-center" style={MONO}>LIVE</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {TIME_BTNS.map(t => (
                      <button key={t} onClick={() => setTf(t)} className={`h-6 px-2 rounded text-[10px] font-bold border transition-all ${tf === t ? "bg-[#10B981] text-white border-[#34D399] shadow-[0_0_12px_rgba(16,185,129,0.50)]" : "bg-[#051510] text-[#6B7A90] border-[#065F46]/40 hover:text-white"}`} style={MONO}>{t}</button>
                    ))}
                    <div className="ml-2 h-6 px-2 rounded bg-[#051510] border border-[#065F46]/40 text-[10px] text-[#94A3B8] flex items-center gap-1">EMA 9 <ChevronDown className="w-3 h-3" /></div>
                  </div>
                </div>
                <div className="flex-1 relative flex">
                  <div className="flex-1 relative p-2 pr-0">
                    <CandleChart data={candles} emaLine={ema9} />
                    <div className="h-[34px] mt-1 flex items-end gap-[2px] px-2">{candles.map((d, i) => <div key={i} className="w-[4px] rounded-[1px]" style={{ height: `${d.v/100*100}%`, background: d.c >= d.o ? "#10B981" : "#EF4444", opacity: 0.7 }} />)}</div>
                    <div className="h-[44px] mt-1 border-t border-[#065F46]/30 relative px-2 pt-1">
                      <div className="absolute left-2 top-1 text-[8px] text-[#6B7A90]" style={MONO}>RSI 14 \u2014 {hasPriceData ? rsi.toFixed(2) : "--"}</div>
                      <svg viewBox="0 0 560 36" className="w-full h-[28px] mt-3">
                        <line x1={0} x2={560} y1={6} y2={6} stroke="#0A1F15" strokeWidth={0.5} strokeDasharray="2 4" />
                        <line x1={0} x2={560} y1={18} y2={18} stroke="#0A1F15" strokeWidth={0.5} />
                        <line x1={0} x2={560} y1={30} y2={30} stroke="#0A1F15" strokeWidth={0.5} strokeDasharray="2 4" />
                        <path d={candles.length > 2 ? `M 0 ${18 + (rsi - 50) / 100 * 24} ${candles.map((_, i) => `L ${8+i*8.2} ${18 + (rsi - 50 + Math.sin(i*0.3)*5) / 100 * 24}`).join(" ")}` : ""} fill="none" stroke="#A855F7" strokeWidth={1.2} />
                      </svg>
                      <div className="absolute right-2 top-1 flex gap-2 text-[7px] text-[#6B7A90]" style={MONO}><span>80</span><span>20</span></div>
                    </div>
                    <div className="flex justify-between px-2 mt-1 text-[9px] text-[#5B6B86]" style={MONO}><span>12:42</span><span>12:43</span><span>12:44</span><span>12:45</span></div>
                  </div>
                  <div className="w-[92px] shrink-0 border-l border-[#065F46]/30 bg-[#040E08]/60 p-1.5 flex flex-col gap-[3px]">
                    {hasPriceData ? [{p: (currentPrice + 1.5).toFixed(2), c:"bg-[#EDE9FE] text-[#1E1B4B]"},{p: (currentPrice + 0.75).toFixed(2), c:"bg-[#A78BFA] text-white"},{p: currentPrice.toFixed(2), c:"bg-[#22C55E] text-black font-bold ring-2 ring-yellow-300"},{p: (currentPrice - 0.75).toFixed(2), c:"bg-[#F97316] text-white"},{p: (currentPrice - 1.5).toFixed(2), c:"bg-[#22D3EE] text-black"},{p: (currentPrice - 2.25).toFixed(2), c:"bg-[#A855F7] text-white"}].map(lv => (
                      <div key={lv.p} className={`h-[22px] rounded-[4px] text-[10px] flex items-center justify-center ${lv.c}`} style={MONO}>{lv.p}</div>
                    )) : <div className="flex-1 flex items-center justify-center text-[9px] text-[#5B6B86]" style={MONO}>Connect to<br/>see live prices</div>}
                    <div className="mt-2 text-[8px] text-[#5B6B86] space-y-1" style={MONO}>
                      <div>EMA 9: {ema9.length > 0 ? ema9[ema9.length-1].toFixed(2) : "--"}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ROW 2 */}
            <div className="grid grid-cols-12 gap-3 h-[180px]">
              {/* MARKET RANKINGS — real data from bot */}
              <div className="col-span-4 panel rounded-xl p-3 flex flex-col">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.14em] font-bold text-[#7FB0D0]">MARKET RANKINGS</span>
                  <span className="text-[9px] px-2 h-4 rounded-full bg-[#7C3AED]/20 text-[#A78BFA] border border-[#7C3AED]/30" style={MONO}>BOT ENGINE</span>
                </div>
                <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto">
                  {storeRankedMarkets.length > 0 ? storeRankedMarkets.map((rm, i) => (
                    <div key={rm.symbol} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${i === 0 ? "bg-[#10B981]/10 border border-[#10B981]/30" : "bg-[#051510]/50"}`}>
                      <span className="text-[9px] font-bold text-[#5B6B86] w-4" style={MONO}>{i + 1}</span>
                      <span className="text-[10px] font-bold text-white w-12" style={MONO}>{rm.symbol}</span>
                      <div className="flex-1 h-[3px] bg-[#071A12] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, rm.score || 0))}%`, background: (rm.score || 0) > 60 ? "#22C55E" : (rm.score || 0) > 30 ? "#EAB308" : "#EF4444" }} />
                      </div>
                      <span className="text-[10px] font-bold w-8 text-right" style={MONO}>{(rm.score || 0).toFixed(0)}</span>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${rm.regime === "TRENDING" ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#EAB308]/20 text-[#EAB308]"}`}>{(rm.regime || "--").slice(0, 4)}</span>
                    </div>
                  )) : (
                    <div className="flex items-center justify-center h-full text-[10px] text-[#3A4A60]">
                      {isConnected ? (storeRunning ? "Scanning markets..." : "Start bot to see rankings") : "Connect to see market rankings"}
                    </div>
                  )}
                </div>
              </div>

              {/* AI QUANTUM SCORE — from real data */}
              <div className="col-span-4 panel rounded-xl p-3 flex">
                <div className="flex-1">
                  <div className="flex items-center justify-between"><span className="text-[10px] tracking-[0.14em] font-bold text-[#7FB0D0]">AI QUANTUM SCORE</span></div>
                  <div className="mt-3 flex items-center gap-4">
                    <div className="relative w-[84px] h-[84px] rounded-full shrink-0" style={{ background: topMarket ? `conic-gradient(#22C55E 0% ${Math.min(100, botScore)}%, #065F46 ${Math.min(100, botScore)}% 100%)` : "conic-gradient(#065F46 0% 100%)" }}>
                      <div className="absolute inset-[8px] rounded-full bg-[#051510] flex flex-col items-center justify-center">
                        <span className="font-extrabold text-[22px] leading-none" style={MONO}>{topMarket ? Math.round(botScore) : "--"}</span>
                        <span className="text-[9px] text-[#6B7A90]" style={MONO}>/100</span>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-[10px]" style={MONO}>
                      {scoreItems.map(s => (
                        <div key={s.l} className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: s.col }} />{s.l} <span className="ml-auto text-white font-bold">{typeof s.v === "number" && s.v % 1 !== 0 ? s.v.toFixed(1) : s.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="w-[1px] bg-[#065F46]/30 mx-3" />
                <div className="flex-1 flex flex-col justify-center">
                  <div className="text-[9px] tracking-widest text-[#6B7A90]">SESSION STATS</div>
                  <div className="mt-2 space-y-2">
                    {[{l:"Win Rate",v: hasStats ? `${stats.winRate.toFixed(1)}%` : "--"},{l:"Avg EV",v: hasStats ? (stats.avgEV * 100).toFixed(1) + "%" : "--"},{l:"AI Strategies",v: hasStats ? String(stats.aiStrategiesLearned) : "--"}].map(b => (
                      <div key={b.l}>
                        <div className="flex justify-between text-[9px]" style={MONO}><span className="text-[#94A3B8]">{b.l}</span><span className="text-white">{b.v}</span></div>
                        <div className="h-[3px] bg-[#071A12] rounded-full mt-1"><div className={`h-full rounded-full ${b.v !== "--" ? "bg-[#10B981]" : "bg-[#065F46]"}`} style={b.v !== "--" && b.l === "Win Rate" ? { width: `${parseFloat(String(b.v))}%` } : b.v !== "--" && b.l === "AI Strategies" ? { width: `${Math.min(100, parseInt(String(b.v)) * 10)}%` } : b.v !== "--" ? { width: `${Math.min(100, Math.max(0, parseFloat(String(b.v))))}%` } : {}} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* MARKET REGIME — from real data */}
              <div className="col-span-4 panel rounded-xl p-3 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.14em] font-bold text-[#7FB0D0]">MARKET REGIME</span>
                  <span className={`w-2 h-2 rounded-full ${botRegime ? "bg-[#22C55E] shadow-[0_0_8px_#22C55E]" : "bg-[#5B6B86]"}`} />
                </div>
                <div className="mt-2 flex gap-3">
                  <div className="flex-1">
                    <div className={`text-[20px] font-extrabold tracking-widest leading-none ${botRegime === "TRENDING" ? "text-[#22C55E] drop-shadow-[0_0_10px_#22C55E]" : botRegime === "RANGING" ? "text-[#EAB308] drop-shadow-[0_0_10px_#EAB308]" : "text-[#5B6B86]"}`}>
                      {botRegime || "N/A"}
                    </div>
                    <svg viewBox="0 0 160 54" className="w-full h-[56px] mt-2">
                      <defs><linearGradient id="mesh" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={botRegime === "TRENDING" ? "#22C55E" : "#EAB308"} stopOpacity={0.5} /><stop offset="100%" stopColor={botRegime === "TRENDING" ? "#22C55E" : "#EAB308"} stopOpacity={0} /></linearGradient></defs>
                      {hasPriceData ? <>
                        <path d="M0 30 Q20 15 40 25 T80 15 T120 20 T160 8 L160 54 L0 54 Z" fill="url(#mesh)" />
                        <path d="M0 30 Q20 15 40 25 T80 15 T120 20 T160 8" fill="none" stroke={botRegime === "TRENDING" ? "#22C55E" : "#EAB308"} strokeWidth={1.5} />
                      </> : <path d="M0 30 Q40 30 80 30 T160 30" fill="none" stroke="#065F46" strokeWidth={1} strokeDasharray="4 4" />}
                    </svg>
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex justify-between text-[9px]" style={MONO}><span className="text-[#6B7A90]">PHASE</span><span className={`font-bold ${storeRunning ? "text-[#22C55E]" : "text-[#5B6B86]"}`}>{storePhase.toUpperCase()}</span></div>
                    <div className="h-[2px] bg-[#071A12] rounded-full"><div className={`h-full rounded-full transition-all duration-500 ${storeRunning ? "bg-[#22C55E]" : "bg-[#065F46]"}`} style={{ width: storeRunning ? "100%" : "10%" }} /></div>
                    <div className="flex justify-between text-[9px]" style={MONO}><span className="text-[#6B7A90]">CYCLES</span><span className="text-white">{hasStats ? stats.cycles : "--"}</span></div>
                    <div className="h-[2px] bg-[#071A12] rounded-full"><div className="h-full bg-[#22D3EE] rounded-full" style={{ width: `${Math.min(100, (storeTicks / 100) * 100)}%` }} /></div>
                    <div className="flex justify-between text-[9px]" style={MONO}><span className="text-[#6B7A90]">RECOVERY</span><span className={hasStats && stats.recoveryMode ? "text-[#EF4444] font-bold" : "text-[#22C55E]"}>{hasStats && stats.recoveryMode ? "ACTIVE" : "NORMAL"}</span></div>
                    <div className="h-[2px] bg-[#071A12] rounded-full"><div className={`h-full rounded-full ${hasStats && stats.recoveryMode ? "bg-[#EF4444]" : "bg-[#22C55E]"}`} style={{ width: hasStats && stats.recoveryMode ? "100%" : "0%" }} /></div>
                  </div>
                </div>
              </div>
            </div>

            {/* ROW 2.5 — EXECUTION GATE MONITOR */}
            <div className="panel rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] tracking-[0.14em] font-bold text-[#7FB0D0]">EXECUTION GATE MONITOR</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] px-2 h-4 rounded-full font-bold tracking-widest flex items-center ${storeRobustnessStage === 'VERIFIED' ? 'bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/30' : storeRobustnessStage === 'ROBUST' ? 'bg-[#22D3EE]/20 text-[#22D3EE] border border-[#22D3EE]/30' : storeRobustnessStage === 'QUARANTINED' ? 'bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/30' : storeRobustnessStage === 'DEGRADING' ? 'bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/30' : 'bg-[#EAB308]/20 text-[#EAB308] border border-[#EAB308]/30'}`} style={MONO}>{storeRobustnessStage}</span>
                  <span className="text-[9px] px-2 h-4 rounded-full bg-[#7C3AED]/20 text-[#A78BFA] border border-[#7C3AED]/30 flex items-center" style={MONO}>V25</span>
                </div>
              </div>
              <div className="grid grid-cols-11 gap-1.5">
                {([['SERVER LOOP','serverLoop'],['AUTH','auth'],['RISK','risk'],['CANDIDATE','candidate'],['ROBUST','robust'],['LIVE EVIDENCE','liveEvidence'],['PROPOSAL','proposal'],['POSITIVE EV','positiveEv'],['LATENCY','latency'],['PERSISTENCE','persistence'],['EXECUTION','execution']] as const).map(([label, key]) => {
                  const passed = storeGates[key as keyof typeof storeGates];
                  return (
                    <div key={key} className={`flex flex-col items-center gap-1 py-1.5 px-1 rounded-lg border ${passed ? 'border-[#22C55E]/30 bg-[#22C55E]/8' : 'border-[#EAB308]/30 bg-[#EAB308]/8'}`}>
                      <div className={`w-2 h-2 rounded-full ${passed ? 'bg-[#38FF88] shadow-[0_0_7px_#38FF88]' : 'bg-[#FFAD45]'}`} />
                      <span className="text-[7px] tracking-wider text-[#88BDD5] text-center leading-tight">{label}</span>
                      <span className={`text-[8px] font-bold ${passed ? 'text-[#38FF88]' : 'text-[#FFAD45]'}`}>{passed ? 'PASS' : 'WAIT'}</span>
                    </div>
                  );
                })}
              </div>
              {/* LUCAS Market Features — show for selected market */}
              {(() => {
                const feat = storeMarketFeatures[market];
                if (!feat?.ready) return null;
                return (
                  <div className="mt-2 pt-2 border-t border-[#065F46]/40 flex items-center gap-4 text-[9px]" style={MONO}>
                    <span className="text-[#6B7A90]">{market}:</span>
                    <span className={feat.regime === 'TRENDING' ? 'text-[#22C55E]' : feat.regime === 'VOLATILE' ? 'text-[#EF4444]' : 'text-[#EAB308]'}>{feat.regime}</span>
                    <span className={feat.volatilityState === 'EXPANDING' ? 'text-[#F97316]' : feat.volatilityState === 'CONTRACTING' ? 'text-[#22D3EE]' : 'text-[#6B7A90]'}>VOL {feat.volatilityState}</span>
                    <span className="text-[#A78BFA]">{feat.strategy}</span>
                    <span className={feat.direction === 'CALL' ? 'text-[#22C55E]' : feat.direction === 'PUT' ? 'text-[#EF4444]' : 'text-[#6B7A90]'}>{feat.direction}</span>
                    <span className="text-cyan-300">RSI {feat.rsi?.toFixed(1) ?? '--'}</span>
                    <span className="text-[#94A3B8]">EMA {feat.trend > 0 ? '+' : ''}{(feat.trend * 100000).toFixed(2)}</span>
                    <span className="text-[#94A3B8]">Score {feat.score.toFixed(0)}</span>
                  </div>
                );
              })()}
            </div>

            {/* ROW 3 */}
            <div className="grid grid-cols-12 gap-3">
              {/* PERFORMANCE — real data from bot */}
              <div className="col-span-3 panel rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.12em] font-bold text-[#7FB0D0]">SESSION PERFORMANCE</span>
                  {storeRunning && <span className="w-2 h-2 bg-[#22C55E] rounded-full animate-pulse shadow-[0_0_8px_#22C55E]" />}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div><div className="text-[8px] tracking-widest text-[#6B7A90]">SESSION P/L</div><div className={`font-bold text-[15px] ${hasStats ? (stats.sessionProfit >= 0 ? "text-[#22C55E]" : "text-[#EF4444]") : "text-[#5B6B86]"}`} style={MONO}>{hasStats ? `${stats.sessionProfit >= 0 ? "+" : ""}$${stats.sessionProfit.toFixed(2)}` : "$--"}</div></div>
                  <div><div className="text-[8px] tracking-widest text-[#6B7A90]">WIN RATE</div><div className={`font-bold text-[13px] ${hasStats ? "text-white" : "text-[#5B6B86]"}`} style={MONO}>{hasStats ? `${stats.winRate.toFixed(1)}%` : "--"}</div></div>
                  <div><div className="text-[8px] tracking-widest text-[#6B7A90]">TRADES</div><div className={`font-bold text-[12px] ${hasStats ? "text-white" : "text-[#5B6B86]"}`} style={MONO}>{hasStats ? `${stats.wins}W/${stats.losses}L` : "--"}</div></div>
                  <div><div className="text-[8px] tracking-widest text-[#6B7A90]">STAKE</div><div className={`font-bold text-[11px] ${hasStats ? "text-[#22C55E]" : "text-[#5B6B86]"}`} style={MONO}>{hasStats ? `$${stats.currentStake.toFixed(2)}` : "--"}</div></div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[9px]" style={MONO}>
                  <div><div className="text-[#6B7A90]">AVG EV</div><div className={hasStats ? (stats.avgEV >= 0 ? "text-[#22C55E]" : "text-[#EF4444]") + " font-bold" : "text-[#5B6B86]"}>{hasStats ? (stats.avgEV * 100).toFixed(1) + "%" : "--"}</div></div>
                  <div><div className="text-[#6B7A90]">CONSEC L</div><div className={`font-bold ${hasStats && stats.consecutiveLosses > 2 ? "text-[#EF4444]" : "text-white"}`}>{hasStats ? String(stats.consecutiveLosses) : "--"}</div></div>
                  <div><div className="text-[#6B7A90]">AI WR</div><div className={`font-bold ${hasStats ? (stats.aiWinRate >= 50 ? "text-[#22C55E]" : "text-[#EAB308]") : "text-[#5B6B86]"}`}>{hasStats ? `${stats.aiWinRate.toFixed(0)}%` : "--"}</div></div>
                </div>
                {/* EQUITY CURVE from trade history */}
                <div className="mt-2">
                  <div className="text-[8px] tracking-widest text-[#6B7A90]">EQUITY CURVE</div>
                  <svg viewBox="0 0 160 40" className="w-full h-[48px] mt-1">
                    <defs><linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22C55E" stopOpacity={0.5} /><stop offset="100%" stopColor="#22C55E" stopOpacity={0} /></linearGradient></defs>
                    {(() => {
                      if (storeTradeHistory.length < 2) {
                        return <path d="M0 20 Q40 20 80 20 T160 20" fill="none" stroke="#065F46" strokeWidth={1} strokeDasharray="4 4" />;
                      }
                      let cum = 0;
                      const pts = storeTradeHistory.slice(-50).map((t, i) => {
                        cum += t.profit;
                        return { x: (i / Math.max(1, storeTradeHistory.slice(-50).length - 1)) * 160, y: 20 - (cum / Math.max(1, Math.abs(cum))) * 16 };
                      });
                      const up = cum >= 0;
                      const col = up ? "#22C55E" : "#EF4444";
                      return <>
                        <path d={`M 0 ${pts[0]?.y ?? 20} ${pts.map(p => `L ${p.x} ${p.y}`).join(" ")} L 160 40 L0 40 Z`} fill={up ? "url(#eqg)" : "none"} opacity={0.5} />
                        <path d={`M 0 ${pts[0]?.y ?? 20} ${pts.map(p => `L ${p.x} ${p.y}`).join(" ")}`} fill="none" stroke={col} strokeWidth={1.5} />
                      </>;
                    })()}
                  </svg>
                </div>
              </div>

              {/* RECENT TRADES — real from bot */}
              <div className="col-span-5 panel rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.12em] font-bold text-[#7FB0D0]">RECENT TRADES</span>
                  <span className="text-[9px] font-bold" style={MONO}>{storeTradeHistory.length > 0 ? `${storeTradeHistory.length} total` : "No trades yet"}</span>
                </div>
                <div className="mt-2 space-y-1 max-h-[200px] overflow-y-auto">
                  {storeTradeHistory.length > 0 ? storeTradeHistory.slice(-8).reverse().map(t => (
                    <div key={t.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] ${t.won ? "bg-[#22C55E]/8" : "bg-[#EF4444]/8"}`} style={MONO}>
                      <span className={`w-1.5 h-1.5 rounded-full ${t.won ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} />
                      <span className="text-white font-bold w-14">{t.symbol}</span>
                      <span className="text-[#94A3B8] w-20 truncate">{t.contractType}</span>
                      {t.barrier !== undefined && <span className="text-[#94A3B8]">d{t.barrier}</span>}
                      <span className={`ml-auto font-bold ${t.won ? "text-[#22C55E]" : "text-[#EF4444]"}`}>{t.won ? "+" : "-"}${Math.abs(t.profit).toFixed(2)}</span>
                      <span className="text-[#5B6B86] w-12 text-right">${t.stake.toFixed(2)}</span>
                    </div>
                  )) : (
                    <div className="flex items-center justify-center h-[120px] text-[10px] text-[#3A4A60]">
                      {isConnected ? (storeRunning ? "Waiting for bot to execute trades..." : "Start the bot to begin trading") : "Connect to Deriv to begin"}
                    </div>
                  )}
                </div>
              </div>

              {/* AI INSIGHTS — real from bot logs */}
              <div className="col-span-4 panel rounded-xl p-3 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.12em] font-bold text-[#7FB0D0]">LIVE BOT LOG</span>
                  <div className={`w-1.5 h-1.5 rounded-full ${storeRunning ? "bg-[#22C55E] animate-pulse" : "bg-[#5B6B86]"}`} />
                </div>
                <div className="mt-3 space-y-3 flex-1 overflow-y-auto">
                  {displayInsights.length > 0 ? displayInsights.slice(0, 8).map((ins, i) => (
                    <div key={i} className="flex gap-2.5">
                      <div className={`w-6 h-6 rounded-full bg-[#0F2A1D] border border-[#2A3A5E] flex items-center justify-center shrink-0 mt-0.5`}>
                        <Zap className="w-3 h-3 text-[#8B5CF6]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-[#6B7A90]" style={MONO}>{ins.t}</span>
                          <span className="text-[9px] font-bold tracking-widest text-[#8B5CF6]">{ins.type}</span>
                          <span className={`ml-auto text-[7px] px-1.5 py-0.5 rounded border font-bold tracking-widest ${ins.bc}`}>{ins.badge}</span>
                        </div>
                        <div className="text-[10px] leading-[1.35] text-[#AAB8CC] mt-0.5 truncate">{ins.msg}</div>
                      </div>
                    </div>
                  )) : (
                    <div className="flex items-center justify-center h-full text-[10px] text-[#3A4A60]">
                      {isConnected ? "Bot logs will appear here..." : "Connect to see live logs"}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* FOOTER — real status */}
            <div className="h-[28px] mt-1 flex items-center justify-between px-3 text-[9px] tracking-widest text-[#5B6B86] border-t border-[#065F46]/30" style={MONO}>
              <div className="flex items-center gap-5">
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shadow-[0_0_6px] ${isConnected ? "bg-[#22C55E] shadow-[#22C55E]" : "bg-[#5B6B86] shadow-[#5B6B86]"}`} />
                  CONNECTION <span className={isConnected ? "text-[#22C55E]" : "text-[#EF4444]"}>{isConnected ? "STABLE" : "OFFLINE"}</span>
                </span>
                <span>ENGINE <span className="text-[#60A5FA]">V25</span></span>
                <span className="px-2 h-4 rounded-full bg-[#065F46]/60 text-[#60A5FA] border border-[#047857] flex items-center">
                  {isConnected ? "DATA FEED REAL-TIME" : "NO DATA FEED"}
                </span>
                <span>SECURITY <span className="text-[#22C55E]">ENCRYPTED</span></span>
              </div>
              <span>LZ-N ULTIMATE BRAIN &copy; 2025</span>
            </div>

          </main>
        </div>
      </div>

      {/* GLOBAL STYLES */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap');
        * { font-family: Inter, system-ui, sans-serif; }
        .panel { background: rgba(5,20,12,0.20); backdrop-filter: blur(8px); border: 1px solid rgba(16,185,129,0.18); box-shadow: 0 0 0 1px rgba(16,185,129,0.05) inset, 0 1px 0 rgba(52,211,153,0.03) inset, 0 4px 16px rgba(0,0,0,0.15); }
        .panel-glow { box-shadow: 0 0 0 1px rgba(16,185,129,0.15) inset, 0 1px 0 rgba(52,211,153,0.04) inset, 0 0 20px rgba(16,185,129,0.08), 0 4px 16px rgba(0,0,0,0.12); }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: #065F46; border-radius: 999px; } ::-webkit-scrollbar-thumb:hover { background: #047857; }
        @keyframes pulseRing { 0% { transform: scale(0.92); opacity: 0.9; } 50% { transform: scale(1); opacity: 1; } 100% { transform: scale(0.92); opacity: 0.9; } }
        @keyframes spinSlow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        /* 4D LUCAS Bot */
        .bot-wrap { position: relative; animation: float4d 4.8s ease-in-out infinite; transform-style: preserve-3d; }
        .lucas-bot { width: 70px; height: 99px; filter: drop-shadow(0 0 18px #533dff) drop-shadow(0 0 10px #00eaff); }
        .bot-aura { position: absolute; width: 90px; height: 90px; left: 50%; top: 50%; transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(circle, rgba(0,238,255,0.2), rgba(99,45,255,0.12) 45%, transparent 70%); animation: aura 2.4s ease-in-out infinite; pointer-events: none; }
        .lucas-eye { position: absolute; width: 5px; height: 2.5px; background: #8fffff; border-radius: 50%; top: 29px; box-shadow: 0 0 7px #5dffff, 0 0 14px #4cf; animation: blink 5s infinite; pointer-events: none; }
        .lucas-eye.e1 { left: 24px; }
        .lucas-eye.e2 { left: 33px; }
        .lucas-bolt { position: absolute; left: 27px; top: 51px; width: 8px; height: 11px; background: #ffe552; clip-path: polygon(45% 0, 100% 0, 65% 40%, 100% 40%, 25% 100%, 43% 55%, 0 55%); filter: drop-shadow(0 0 8px #ffcc00); animation: bolt 1.1s infinite alternate; pointer-events: none; }
        @keyframes float4d { 0%, 100% { transform: translateY(0) rotateY(-5deg) rotateX(1deg); } 50% { transform: translateY(-8px) rotateY(7deg) rotateX(-2deg) scale(1.025); } }
        @keyframes blink { 0%, 45%, 48%, 100% { transform: scaleY(1); opacity: 1; } 46%, 47% { transform: scaleY(0.08); opacity: 0.4; } }
        @keyframes aura { 0%, 100% { transform: translate(-50%, -50%) scale(0.95); opacity: 0.55; } 50% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; } }
        @keyframes bolt { from { opacity: 0.55; transform: scale(0.9); } to { opacity: 1; transform: scale(1.15); } }
      `}</style>
    </div>
  );
}
