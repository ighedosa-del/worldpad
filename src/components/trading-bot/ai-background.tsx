'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useBotStore } from '@/lib/bot-v2/store';

// === AI Neural Network Background ===
// Canvas-based animated neural network visualization.
// Responds to bot state: nodes pulse on trades, color shifts with P/L.

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseRadius: number;
  pulsePhase: number;
  connections: number[];
  layer: number;
  activation: number;
}

interface DataPacket {
  fromIdx: number;
  toIdx: number;
  progress: number;
  speed: number;
  color: string;
  size: number;
}

const NODE_COUNT = 60;
const MAX_CONNECTION_DIST = 180;
const DATA_PACKET_INTERVAL = 800;

const COLORS = {
  nodeIdle: 'rgba(100, 116, 139, 0.6)',      // slate-500
  nodeActive: 'rgba(16, 185, 129, 0.8)',       // emerald-500
  nodeHot: 'rgba(234, 179, 8, 0.8)',           // amber-500
  nodeLoss: 'rgba(239, 68, 68, 0.7)',          // red-500
  connectionIdle: 'rgba(100, 116, 139, 0.08)',
  connectionActive: 'rgba(16, 185, 129, 0.15)',
  connectionLoss: 'rgba(239, 68, 68, 0.12)',
  packetWin: '#10b981',
  packetLoss: '#ef4444',
  packetIdle: '#64748b',
  gridLine: 'rgba(100, 116, 139, 0.03)',
};

export function AIBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const packetsRef = useRef<DataPacket[]>([]);
  const animRef = useRef<number>(0);
  const lastPacketTime = useRef(0);
  const flashRef = useRef<'win' | 'loss' | null>(null);
  const flashAlpha = useRef(0);

  const initNodes = useCallback((width: number, height: number) => {
    const nodes: Node[] = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      const layer = Math.floor(Math.random() * 3); // 0=input, 1=hidden, 2=output
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: 2 + Math.random() * 2,
        baseRadius: 2 + Math.random() * 2,
        pulsePhase: Math.random() * Math.PI * 2,
        connections: [],
        layer,
        activation: Math.random() * 0.3,
      });
    }
    // Build connections (each node connects to 2-4 nearest in next layer)
    for (let i = 0; i < nodes.length; i++) {
      const sameOrNext = nodes.filter(n => n.layer >= nodes[i].layer && n !== nodes[i]);
      sameOrNext.sort((a, b) => {
        const dA = Math.hypot(a.x - nodes[i].x, a.y - nodes[i].y);
        const dB = Math.hypot(b.x - nodes[i].x, b.y - nodes[i].y);
        return dA - dB;
      });
      const connCount = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < Math.min(connCount, sameOrNext.length); j++) {
        const idx = nodes.indexOf(sameOrNext[j]);
        if (idx >= 0 && !nodes[i].connections.includes(idx)) {
          nodes[i].connections.push(idx);
        }
      }
    }
    return nodes;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    nodesRef.current = initNodes(width, height);

    // Subscribe to store for trade events
    const unsub = useBotStore.subscribe((state, prev) => {
      const currHistory = state.tradeHistory;
      const prevHistory = prev.tradeHistory;
      if (currHistory.length > prevHistory.length) {
        const latest = currHistory[0];
        if (latest && !latest.simulated) {
          flashRef.current = latest.won ? 'win' : 'loss';
          flashAlpha.current = 0.3;
          // Spawn burst of data packets on trade
          const nodes = nodesRef.current;
          for (let i = 0; i < 5; i++) {
            const fromIdx = Math.floor(Math.random() * nodes.length);
            const conns = nodes[fromIdx].connections;
            if (conns.length > 0) {
              const toIdx = conns[Math.floor(Math.random() * conns.length)];
              packetsRef.current.push({
                fromIdx,
                toIdx,
                progress: 0,
                speed: 0.015 + Math.random() * 0.02,
                color: latest.won ? COLORS.packetWin : COLORS.packetLoss,
                size: 2 + Math.random() * 2,
              });
            }
          }
        }
      }
    });

    const animate = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const nodes = nodesRef.current;
      const packets = packetsRef.current;
      const running = useBotStore.getState().running;
      const phase = useBotStore.getState().phase;
      const stats = useBotStore.getState().stats;
      const profit = stats?.sessionProfit ?? 0;

      // Fade flash
      if (flashAlpha.current > 0) {
        flashAlpha.current *= 0.95;
        if (flashAlpha.current < 0.01) {
          flashAlpha.current = 0;
          flashRef.current = null;
        }
      }

      // Background flash overlay
      if (flashAlpha.current > 0 && flashRef.current) {
        const flashColor = flashRef.current === 'win' ? '16, 185, 129' : '239, 68, 68';
        ctx.fillStyle = `rgba(${flashColor}, ${flashAlpha.current * 0.08})`;
        ctx.fillRect(0, 0, width, height);
      }

      // Subtle grid
      ctx.strokeStyle = COLORS.gridLine;
      ctx.lineWidth = 0.5;
      const gridSize = 60;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      // Update node positions
      const speedMult = running ? 1.5 : 0.5;
      for (const node of nodes) {
        node.x += node.vx * speedMult;
        node.y += node.vy * speedMult;

        // Bounce off edges
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
        node.x = Math.max(0, Math.min(width, node.x));
        node.y = Math.max(0, Math.min(height, node.y));

        // Pulse
        node.pulsePhase += 0.02;
        const pulse = running ? Math.sin(node.pulsePhase) * 0.5 + 0.5 : 0.2;
        node.radius = node.baseRadius * (0.8 + pulse * 0.6);

        // Activation decay
        node.activation *= 0.995;
      }

      // Draw connections
      ctx.lineWidth = 0.5;
      for (const node of nodes) {
        for (const connIdx of node.connections) {
          if (connIdx >= nodes.length) continue;
          const other = nodes[connIdx];
          const dist = Math.hypot(other.x - node.x, other.y - node.y);
          if (dist > MAX_CONNECTION_DIST) continue;

          const alpha = (1 - dist / MAX_CONNECTION_DIST) * 0.12;
          const activation = (node.activation + other.activation) / 2;
          const isActive = activation > 0.3 || running;

          if (flashRef.current === 'loss' && flashAlpha.current > 0.05) {
            ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 1.5})`;
          } else if (isActive) {
            ctx.strokeStyle = `rgba(16, 185, 129, ${alpha * 1.2})`;
          } else {
            ctx.strokeStyle = `rgba(100, 116, 139, ${alpha})`;
          }
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(other.x, other.y);
          ctx.stroke();
        }
      }

      // Draw data packets
      for (let i = packets.length - 1; i >= 0; i--) {
        const pkt = packets[i];
        pkt.progress += pkt.speed;
        if (pkt.progress >= 1) {
          // Activate destination node
          if (pkt.toIdx < nodes.length) {
            nodes[pkt.toIdx].activation = 1;
          }
          packets.splice(i, 1);
          continue;
        }
        const from = nodes[pkt.fromIdx];
        const to = nodes[pkt.toIdx];
        if (!from || !to) continue;
        const px = from.x + (to.x - from.x) * pkt.progress;
        const py = from.y + (to.y - from.y) * pkt.progress;

        // Glow
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, pkt.size * 4);
        gradient.addColorStop(0, pkt.color + '40');
        gradient.addColorStop(1, pkt.color + '00');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, pkt.size * 4, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = pkt.color;
        ctx.beginPath();
        ctx.arc(px, py, pkt.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Spawn ambient packets periodically when running
      if (running && time - lastPacketTime.current > DATA_PACKET_INTERVAL) {
        lastPacketTime.current = time;
        const fromIdx = Math.floor(Math.random() * nodes.length);
        const conns = nodes[fromIdx].connections;
        if (conns.length > 0) {
          const toIdx = conns[Math.floor(Math.random() * conns.length)];
          packets.push({
            fromIdx,
            toIdx,
            progress: 0,
            speed: 0.008 + Math.random() * 0.012,
            color: COLORS.packetIdle,
            size: 1.5 + Math.random() * 1.5,
          });
          nodes[fromIdx].activation = Math.min(nodes[fromIdx].activation + 0.3, 1);
        }
      }

      // Draw nodes
      for (const node of nodes) {
        const activation = node.activation;
        let fillColor: string;
        let glowColor: string;

        if (activation > 0.6) {
          fillColor = COLORS.nodeActive;
          glowColor = '16, 185, 129';
        } else if (activation > 0.3) {
          fillColor = COLORS.nodeHot;
          glowColor = '234, 179, 8';
        } else {
          fillColor = COLORS.nodeIdle;
          glowColor = '100, 116, 139';
        }

        // Glow
        if (activation > 0.1) {
          const glowRadius = node.radius * (3 + activation * 4);
 const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
          gradient.addColorStop(0, `rgba(${glowColor}, ${activation * 0.3})`);
          gradient.addColorStop(1, `rgba(${glowColor}, 0)`);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Node core
        ctx.fillStyle = fillColor;
        ctx.globalAlpha = 0.5 + activation * 0.5;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // P/L indicator — subtle color tint in bottom-right
      if (stats && stats.totalTrades > 0) {
        const pColor = profit >= 0 ? '16, 185, 129' : '239, 68, 68';
        const pAlpha = Math.min(Math.abs(profit) * 0.005, 0.06);
        const gradient = ctx.createRadialGradient(width, height, 0, width, height, 400);
        gradient.addColorStop(0, `rgba(${pColor}, ${pAlpha})`);
        gradient.addColorStop(1, `rgba(${pColor}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(width - 400, height - 400, 400, 400);
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
      unsub();
    };
  }, [initNodes]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.7 }}
    />
  );
}
