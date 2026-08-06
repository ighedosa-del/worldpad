'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useWorldpadStore } from '@/lib/store';
import { connectDerivWS, switchSymbol, disconnectDerivWS, isSimulating } from '@/lib/deriv-ws';

export function useDerivConnection() {
  const store = useWorldpadStore();
  const {
    setIsConnecting,
    setIsConnected,
    setLivePrice,
    setCurrentDigit,
    setDigitDistribution,
    addOverUnderHistory,
    addMatchDifferHistory,
    addEvenOddHistory,
    addRiseFallHistory,
    addDigitHistory,
    incrementTickCount,
    setLastTickTime,
    activeMarket,
    analysisOverUnderDigit,
    analysisMatchDifferDigit,
  } = store;

  const prevPrice = useRef<number>(0);
  const digitCounts = useRef<number[]>(new Array(10).fill(0));
  const totalTicks = useRef(0);
  const initRef = useRef(false);
  const digitsRef = useRef({ ouDigit: analysisOverUnderDigit, mdDigit: analysisMatchDifferDigit });

  useEffect(() => {
    digitsRef.current = { ouDigit: analysisOverUnderDigit, mdDigit: analysisMatchDifferDigit };
  }, [analysisOverUnderDigit, analysisMatchDifferDigit]);

  const handleTick = useCallback((data: { tick: number; digit: number; price: string }) => {
    setLivePrice(data.tick);
    setCurrentDigit(data.digit);
    incrementTickCount();
    setLastTickTime(Date.now());

    digitCounts.current[data.digit]++;
    totalTicks.current++;
    const dist = digitCounts.current.map((c) =>
      totalTicks.current > 0 ? (c / totalTicks.current) * 100 : 10
    );
    setDigitDistribution(dist);
    addDigitHistory(data.digit);

    if (data.digit > digitsRef.current.ouDigit) {
      addOverUnderHistory('O');
    } else {
      addOverUnderHistory('U');
    }

    if (data.digit === digitsRef.current.mdDigit) {
      addMatchDifferHistory('M');
    } else {
      addMatchDifferHistory('D');
    }

    addEvenOddHistory(data.digit % 2 === 0 ? 'E' : 'O');

    if (prevPrice.current > 0) {
      addRiseFallHistory(data.tick > prevPrice.current ? 'R' : 'F');
    }
    prevPrice.current = data.tick;
  }, [setLivePrice, setCurrentDigit, setDigitDistribution, addDigitHistory, addOverUnderHistory, addMatchDifferHistory, addEvenOddHistory, addRiseFallHistory, incrementTickCount, setLastTickTime]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    setIsConnecting(true);

    connectDerivWS(
      activeMarket,
      handleTick,
      undefined, // no balance in simulation mode
      () => {
        setIsConnecting(false);
        setIsConnected(true);
      },
      () => {
        setIsConnected(false);
        setIsConnecting(true);
      }
    );

    return () => {
      disconnectDerivWS();
      initRef.current = false;
    };
  }, [activeMarket, handleTick, setIsConnecting, setIsConnected]);

  useEffect(() => {
    if (store.isConnected) {
      switchSymbol(activeMarket);
    }
  }, [activeMarket, store.isConnected]);

  return { isConnected: store.isConnected, isSimulating: isSimulating() };
}
