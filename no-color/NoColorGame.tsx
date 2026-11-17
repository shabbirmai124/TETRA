import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import {
  NC_COLS,
  NC_ROWS,
  NC_VISIBLE_START,
  NoColorEngine,
  NoColorSnapshot,
  NoColorStepEvent,
} from './engine';
import { GameOptions, ScreenState } from '../src/types/game';
import { PiecePreview } from '../src/components/PiecePreview';
import { soundSynth } from '../src/audio/synth';

const BEST_SCORE_KEY = 'tetra_no_color_best_v1';

const loadBestScore = (): number => {
  try {
    const raw = localStorage.getItem(BEST_SCORE_KEY);
    return raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
  } catch {
    return 0;
  }
};

const saveBestScore = (score: number): void => {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(score));
  } catch {
    // Ignore storage quota issues
  }
};

interface NoColorGameProps {
  screen: ScreenState;
  runNonce: number;
  options: GameOptions;
  onPause: () => void;
  onGameOver: (snapshot: NoColorSnapshot) => void;
  onToggleSound: () => void;
}

const VISIBLE_ROWS = NC_ROWS - NC_VISIBLE_START; // 20
const CELL_PX = 28;
const CANVAS_W = NC_COLS * CELL_PX; // 280
const CANVAS_H = VISIBLE_ROWS * CELL_PX; // 560

export const NoColorGame: React.FC<NoColorGameProps> = ({
  screen,
  runNonce,
  options,
  onPause,
  onGameOver,
  onToggleSound,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const engineRef = useRef<NoColorEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new NoColorEngine(
      Date.now() ^ 0x517cc1b7,
      loadBestScore(),
      options.startLevel,
    );
  }

  const [hud, setHud] = useState<NoColorSnapshot>(() => engineRef.current!.getSnapshot());

  // Refs for latest props inside scheduler without restarting effect
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  // Input state kept outside React
  const heldRef = useRef({
    left: false,
    right: false,
    down: false,
    moveDir: 0 as -1 | 0 | 1,
    dasTimerMs: 0,
    arrTimerMs: 0,
    softTimerMs: 0,
  });

  const lastHudSigRef = useRef('');
  const lastRenderStateRef = useRef({
    rev: -1,
    lockBucket: -1,
    flash: -1,
    blast: -1,
    sparks: -1,
    optsBits: -1,
  });
  const wakeLoopRef = useRef<() => void>(() => {});
  const gridCacheRef = useRef<{ canvas: HTMLCanvasElement; gridLines: boolean } | null>(null);
  const spriteCacheRef = useRef<{
    block: HTMLCanvasElement;
    superBlock: HTMLCanvasElement;
    ghost: HTMLCanvasElement;
  } | null>(null);
  // Fixed 48 monochrome fire-spark ring buffer (x, y, vx, vy, life) = 960B, zero GC
  const sparkPoolRef = useRef(new Float32Array(48 * 5));
  const sparkCursorRef = useRef(0);
  const sparksAliveRef = useRef(0);
  const lastImpactNonceRef = useRef(0);

  const emitSparks = useCallback((cx: number, cy: number, kind: 0 | 1 | 2) => {
    const pool = sparkPoolRef.current;
    const count = kind === 2 ? 42 : kind === 1 ? 26 : 10;
    let seed = (Date.now() ^ (cx * 73856093) ^ (cy * 19349663)) >>> 0 || 1;
    const nextRand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      const idx = sparkCursorRef.current * 5;
      sparkCursorRef.current = (sparkCursorRef.current + 1) % 48;
      if (kind === 2) {
        const ang = (i / count) * Math.PI * 2 + (nextRand() - 0.5) * 0.25;
        const spd = 4.2 + nextRand() * 7.5;
        pool[idx] = cx;
        pool[idx + 1] = cy;
        pool[idx + 2] = Math.cos(ang) * spd;
        pool[idx + 3] = Math.sin(ang) * spd - 1.8;
        pool[idx + 4] = 0.36 + nextRand() * 0.22;
      } else if (kind === 1) {
        const px = 0.4 + nextRand() * 9.2;
        const dx = px - cx;
        pool[idx] = px;
        pool[idx + 1] = cy + (nextRand() - 0.5) * 0.5;
        pool[idx + 2] = dx * 1.15 + (nextRand() - 0.5) * 5.2;
        pool[idx + 3] = -(1.8 + nextRand() * 5.8);
        pool[idx + 4] = 0.28 + nextRand() * 0.22;
      } else {
        pool[idx] = cx + (nextRand() - 0.5) * 2.4;
        pool[idx + 1] = cy + 0.35;
        pool[idx + 2] = (nextRand() - 0.5) * 4.8;
        pool[idx + 3] = -(1.2 + nextRand() * 3.0);
        pool[idx + 4] = 0.18 + nextRand() * 0.12;
      }
    }
    sparksAliveRef.current = count;
  }, []);

  const syncHudIfChanged = useCallback((force = false) => {
    const engine = engineRef.current;
    if (!engine) return;
    const snap = engine.getSnapshot();
    const sig = `${snap.score}|${snap.level}|${snap.lines}|${snap.combo}|${snap.b2b}|${snap.holdId}|${snap.holdIsSuper}|${snap.canHold}|${snap.isSuperActive}|${snap.isNextSuper}|${snap.superBlasts}|${snap.nextIds.join(',')}|${snap.lastCallout}|${snap.gameOver}`;
    if (force || sig !== lastHudSigRef.current) {
      lastHudSigRef.current = sig;
      if (snap.bestScore > loadBestScore()) {
        saveBestScore(snap.bestScore);
      }
      setHud(snap);
    }
  }, []);

  const triggerSound = useCallback((ev: NoColorStepEvent) => {
    if (!optionsRef.current.soundEnabled || ev === 'none' || ev === 'lock') return;
    if (
      ev === 'move' ||
      ev === 'rotate' ||
      ev === 'softDrop' ||
      ev === 'hardDrop' ||
      ev === 'hold' ||
      ev === 'line1' ||
      ev === 'line2' ||
      ev === 'line3' ||
      ev === 'quad' ||
      ev === 'blast' ||
      ev === 'levelUp' ||
      ev === 'gameOver'
    ) {
      soundSynth.play(ev);
    }
  }, []);

  // Pre-bake 28x28 architectural monochrome wireframe, Super crosshair, and ghost sprites once
  const ensureSprites = () => {
    if (spriteCacheRef.current) return spriteCacheRef.current;
    const block = document.createElement('canvas');
    block.width = CELL_PX;
    block.height = CELL_PX;
    const bctx = block.getContext('2d');
    if (bctx) {
      // Dark stone core + crisp architectural white wireframe bevel & micro-grid
      bctx.fillStyle = '#050505';
      bctx.fillRect(0, 0, CELL_PX, CELL_PX);
      bctx.fillStyle = '#171717';
      bctx.fillRect(1, 1, CELL_PX - 2, CELL_PX - 2);
      // Top-left bright facet rim
      bctx.fillStyle = '#FFFFFF';
      bctx.fillRect(1, 1, CELL_PX - 2, 2);
      bctx.fillRect(1, 1, 2, CELL_PX - 2);
      // Bottom-right structural wire rim
      bctx.fillStyle = '#8A8A8A';
      bctx.fillRect(1, CELL_PX - 2, CELL_PX - 2, 1);
      bctx.fillRect(CELL_PX - 2, 1, 1, CELL_PX - 2);
      // Inner wireframe box + architectural crosshatch
      bctx.strokeStyle = '#D4D4D4';
      bctx.lineWidth = 1;
      bctx.strokeRect(5.5, 5.5, CELL_PX - 11, CELL_PX - 11);
      bctx.fillStyle = '#525252';
      bctx.fillRect(6, 13, CELL_PX - 12, 1);
      bctx.fillRect(13, 6, 1, CELL_PX - 12);
    }

    const superBlock = document.createElement('canvas');
    superBlock.width = CELL_PX;
    superBlock.height = CELL_PX;
    const sctx = superBlock.getContext('2d');
    if (sctx) {
      // Blazing white architectural Super Block with dark diamond core
      sctx.fillStyle = '#FFFFFF';
      sctx.fillRect(1, 1, CELL_PX - 2, CELL_PX - 2);
      sctx.fillStyle = '#111111';
      sctx.fillRect(5, 5, CELL_PX - 10, CELL_PX - 10);
      sctx.fillStyle = '#FFFFFF';
      sctx.beginPath();
      sctx.moveTo(CELL_PX / 2, 7);
      sctx.lineTo(CELL_PX - 7, CELL_PX / 2);
      sctx.lineTo(CELL_PX / 2, CELL_PX - 7);
      sctx.lineTo(7, CELL_PX / 2);
      sctx.closePath();
      sctx.fill();
      sctx.fillStyle = '#000000';
      sctx.fillRect(CELL_PX / 2 - 2, CELL_PX / 2 - 2, 4, 4);
    }

    const ghost = document.createElement('canvas');
    ghost.width = CELL_PX;
    ghost.height = CELL_PX;
    const gctx = ghost.getContext('2d');
    if (gctx) {
      gctx.strokeStyle = '#737373';
      gctx.lineWidth = 1;
      gctx.setLineDash([3, 3]);
      gctx.strokeRect(2.5, 2.5, CELL_PX - 5, CELL_PX - 5);
    }

    spriteCacheRef.current = { block, superBlock, ghost };
    return spriteCacheRef.current;
  };

  // Zero-allocation integer dirty-checked Canvas2D sprite blitter + monochrome spark/starburst FX
  const renderCanvas = useCallback((force = false) => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    if (engine.impactNonce !== lastImpactNonceRef.current) {
      lastImpactNonceRef.current = engine.impactNonce;
      const impactVisibleY = Math.max(0.5, engine.lastImpactY - NC_VISIBLE_START + 0.5);
      emitSparks(engine.lastImpactX, impactVisibleY, engine.lastImpactKind);
    }

    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext('2d', { alpha: false });
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    const opts = optionsRef.current;
    const lockBucket = Math.floor(engine.getLockProgress() * 4);
    const flashBucket = engine.clearFlashTimer > 0 ? Math.ceil(engine.clearFlashTimer * 30) : 0;
    const blastBucket = engine.blastFlashTimer > 0 ? Math.ceil(engine.blastFlashTimer * 30) : 0;
    const hasSparks = sparksAliveRef.current > 0;
    const optsBits =
      (opts.gridLines ? 1 : 0) |
      (opts.ghostPiece ? 2 : 0) |
      (engine.gameOver ? 4 : 0) |
      (engine.isSuperActive ? 8 : 0);
    const prev = lastRenderStateRef.current;
    if (
      !force &&
      !hasSparks &&
      flashBucket === 0 &&
      blastBucket === 0 &&
      prev.rev === engine.boardRevision &&
      prev.lockBucket === lockBucket &&
      prev.flash === flashBucket &&
      prev.blast === blastBucket &&
      prev.sparks === 0 &&
      prev.optsBits === optsBits
    ) {
      return;
    }
    prev.rev = engine.boardRevision;
    prev.lockBucket = lockBucket;
    prev.flash = flashBucket;
    prev.blast = blastBucket;
    prev.sparks = hasSparks ? 1 : 0;
    prev.optsBits = optsBits;

    // Blit pre-cached static dark well & grid lines in 1 call
    if (!gridCacheRef.current || gridCacheRef.current.gridLines !== opts.gridLines) {
      const off = gridCacheRef.current?.canvas ?? document.createElement('canvas');
      off.width = CANVAS_W;
      off.height = CANVAS_H;
      const octx = off.getContext('2d', { alpha: false });
      if (octx) {
        octx.fillStyle = '#030303';
        octx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        if (opts.gridLines) {
          octx.strokeStyle = '#191919';
          octx.lineWidth = 1;
          octx.beginPath();
          for (let c = 1; c < NC_COLS; c++) {
            const x = c * CELL_PX + 0.5;
            octx.moveTo(x, 0);
            octx.lineTo(x, CANVAS_H);
          }
          for (let r = 1; r < VISIBLE_ROWS; r++) {
            const y = r * CELL_PX + 0.5;
            octx.moveTo(0, y);
            octx.lineTo(CANVAS_W, y);
          }
          octx.stroke();
        }
      }
      gridCacheRef.current = { canvas: off, gridLines: opts.gridLines };
    }
    ctx.drawImage(gridCacheRef.current.canvas, 0, 0);

    const sprites = ensureSprites();

    // Locked bitboard cells (pure integer drawImage blits)
    for (let r = NC_VISIBLE_START; r < NC_ROWS; r++) {
      const rowBits = engine.board[r];
      if (rowBits === 0) continue;
      const py = (r - NC_VISIBLE_START) * CELL_PX;
      for (let c = 0; c < NC_COLS; c++) {
        if ((rowBits & (1 << c)) !== 0) {
          ctx.drawImage(sprites.block, c * CELL_PX, py);
        }
      }
    }

    if (!engine.gameOver) {
      const mask = engine.getMask(engine.activeId, engine.activeRot);
      const activeSprite = engine.isSuperActive ? sprites.superBlock : sprites.block;

      // Ghost piece outline (pre-baked sprite blit)
      if (opts.ghostPiece && engine.ghostY !== engine.activeY) {
        for (let r = 0; r < 4; r++) {
          const rowNibble = (mask >>> (r << 2)) & 0xf;
          if (rowNibble === 0) continue;
          const gy = engine.ghostY + r - NC_VISIBLE_START;
          if (gy < 0 || gy >= VISIBLE_ROWS) continue;
          const py = gy * CELL_PX;
          for (let c = 0; c < 4; c++) {
            if ((rowNibble & (1 << c)) === 0) continue;
            ctx.drawImage(sprites.ghost, (engine.activeX + c) * CELL_PX, py);
          }
        }
      }

      // Active piece + optional lock-warning center marker
      const showLockDot = lockBucket > 0;
      for (let r = 0; r < 4; r++) {
        const rowNibble = (mask >>> (r << 2)) & 0xf;
        if (rowNibble === 0) continue;
        const gy = engine.activeY + r - NC_VISIBLE_START;
        if (gy < 0 || gy >= VISIBLE_ROWS) continue;
        const py = gy * CELL_PX;
        for (let c = 0; c < 4; c++) {
          if ((rowNibble & (1 << c)) === 0) continue;
          const px = (engine.activeX + c) * CELL_PX;
          ctx.drawImage(activeSprite, px, py);
          if (showLockDot) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(px + 10, py + 10, CELL_PX - 20, CELL_PX - 20);
          }
        }
      }
    }

    // Row-targeted horizontal monochrome laser beam + radial starburst on line clears
    if (engine.clearFlashTimer > 0) {
      const t = Math.min(1, engine.clearFlashTimer / 0.24);
      let firstBeamPy = -1;
      let lastBeamPy = -1;
      for (let r = NC_VISIBLE_START; r < NC_ROWS; r++) {
        if ((engine.clearFlashRowsMask & (1 << r)) !== 0) {
          const py = (r - NC_VISIBLE_START) * CELL_PX;
          if (firstBeamPy < 0) firstBeamPy = py;
          lastBeamPy = py;
          ctx.fillStyle = `rgba(212, 212, 212, ${t * 0.48})`;
          ctx.fillRect(0, py + 3, CANVAS_W, CELL_PX - 6);
          ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, t * 1.1)})`;
          ctx.fillRect(0, py + Math.floor(CELL_PX / 2) - 3, CANVAS_W, 6);
        }
      }
      if (firstBeamPy >= 0) {
        const cx = Math.round(engine.lastImpactX * CELL_PX);
        const cy = Math.round((firstBeamPy + lastBeamPy + CELL_PX) * 0.5);
        const rayLen = 28 + t * 44;
        ctx.strokeStyle = `rgba(255, 255, 255, ${t})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx - rayLen * 1.4, cy);
        ctx.lineTo(cx + rayLen * 1.4, cy);
        ctx.moveTo(cx, cy - rayLen * 0.9);
        ctx.lineTo(cx, cy + rayLen * 0.9);
        ctx.moveTo(cx - rayLen * 0.65, cy - rayLen * 0.65);
        ctx.lineTo(cx + rayLen * 0.65, cy + rayLen * 0.65);
        ctx.moveTo(cx - rayLen * 0.65, cy + rayLen * 0.65);
        ctx.lineTo(cx + rayLen * 0.65, cy - rayLen * 0.65);
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - 5, cy - 5, 10, 10);
      }
    }

    // 5x5 Super Blast shockwave ring + starburst flare
    if (engine.blastFlashTimer > 0) {
      const bt = Math.min(1, engine.blastFlashTimer / 0.28);
      const bx = Math.round(engine.lastImpactX * CELL_PX);
      const by = Math.round(Math.max(0.5, engine.lastImpactY - NC_VISIBLE_START + 0.5) * CELL_PX);
      const radius = Math.round((1 - bt) * 86 + 18);
      ctx.strokeStyle = `rgba(255, 255, 255, ${bt * 0.9})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.stroke();

      const flare = 24 + bt * 52;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx - flare, by);
      ctx.lineTo(bx + flare, by);
      ctx.moveTo(bx, by - flare);
      ctx.lineTo(bx, by + flare);
      ctx.stroke();
    }

    // Monochrome fire-spark streaks (zero-GC Float32Array pool)
    if (hasSparks) {
      const pool = sparkPoolRef.current;
      for (let i = 0; i < 48; i++) {
        const idx = i * 5;
        const life = pool[idx + 4];
        if (life <= 0) continue;
        const alpha = Math.min(1, life * 2.6);
        const sx = Math.round(pool[idx] * CELL_PX);
        const sy = Math.round(pool[idx + 1] * CELL_PX);
        const tx = Math.round((pool[idx] - pool[idx + 2] * 0.025) * CELL_PX);
        const ty = Math.round((pool[idx + 1] - pool[idx + 3] * 0.025) * CELL_PX);
        ctx.strokeStyle = alpha > 0.6 ? '#FFFFFF' : '#A3A3A3';
        ctx.lineWidth = alpha > 0.65 ? 2 : 1.5;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(sx - 1, sy - 1, 3, 3);
      }
      ctx.globalAlpha = 1;
    }
  }, [emitSparks]);

  // Reset engine whenever runNonce increments
  useEffect(() => {
    if (runNonce === 0) return;
    const engine = engineRef.current!;
    engine.reset(Date.now() ^ (runNonce * 2654435761), optionsRef.current.startLevel);
    sparkPoolRef.current.fill(0);
    sparksAliveRef.current = 0;
    lastImpactNonceRef.current = 0;
    heldRef.current.left = false;
    heldRef.current.right = false;
    heldRef.current.down = false;
    heldRef.current.moveDir = 0;
    heldRef.current.dasTimerMs = 0;
    heldRef.current.arrTimerMs = 0;
    heldRef.current.softTimerMs = 0;
    syncHudIfChanged(true);
    renderCanvas(true);
    wakeLoopRef.current();
  }, [runNonce, syncHudIfChanged, renderCanvas]);

  // Low-Power Event-Driven + Adaptive rAF Simulation Loop
  //   * Paused / Game Over: 0% CPU (no timers or rAF scheduled).
  //   * Low-Power Idle (no keys held & no flash): sleeps until exact next gravity/lock timestamp.
  //   * Active Motion (held DAS/ARR/soft-drop or flash): smooth 60fps rAF until idle again.
  useEffect(() => {
    let rafId = 0;
    let timeoutId = 0;
    let lastTime = performance.now();
    let disposed = false;

    const clearSchedules = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = 0;
      }
    };

    const stepAndSchedule = (now: number) => {
      if (disposed) return;
      const engine = engineRef.current!;
      const activeScreen = screenRef.current;
      const opts = optionsRef.current;

      if (activeScreen !== 'playing' || engine.gameOver) {
        renderCanvas(false);
        return; // Sleep completely when paused or game over
      }

      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      // Allow large wake intervals in low-power sleep while capping active step bursts cleanly
      const maxDt = opts.lowPowerMode ? 0.25 : 0.05;
      const dt = Math.min(Math.max(0, rawDt), maxDt);

      const h = heldRef.current;
      if (h.moveDir !== 0) {
        h.dasTimerMs += dt * 1000;
        if (h.dasTimerMs >= opts.dasMs) {
          if (opts.arrMs <= 0) {
            while (engine.move(h.moveDir)) {
              // instant DAS slide
            }
          } else {
            h.arrTimerMs += dt * 1000;
            while (h.arrTimerMs >= opts.arrMs) {
              h.arrTimerMs -= opts.arrMs;
              if (engine.move(h.moveDir)) {
                triggerSound('move');
              }
            }
          }
        }
      }

      if (h.down) {
        const softIntervalMs = Math.max(12, 500 / Math.max(1, opts.sdf));
        h.softTimerMs += dt * 1000;
        while (h.softTimerMs >= softIntervalMs) {
          h.softTimerMs -= softIntervalMs;
          if (engine.softDropStep()) {
            triggerSound('softDrop');
          }
        }
      }

      const ev = engine.tick(dt);
      if (ev !== 'none') {
        triggerSound(ev);
      }
      // Step monochrome spark pool cleanly in-place
      if (sparksAliveRef.current > 0) {
        const pool = sparkPoolRef.current;
        let alive = 0;
        for (let i = 0; i < 48; i++) {
          const idx = i * 5;
          if (pool[idx + 4] > 0) {
            pool[idx] += pool[idx + 2] * dt;
            pool[idx + 1] += pool[idx + 3] * dt;
            pool[idx + 3] += 14 * dt;
            pool[idx + 4] -= dt;
            if (pool[idx + 4] > 0) alive++;
          }
        }
        sparksAliveRef.current = alive;
      }

      syncHudIfChanged();
      renderCanvas(false);

      if (engine.gameOver) {
        const finalSnap = engine.getSnapshot();
        if (finalSnap.bestScore > loadBestScore()) {
          saveBestScore(finalSnap.bestScore);
        }
        onGameOverRef.current(finalSnap);
        return;
      }

      const hasHeldMotion = h.moveDir !== 0 || h.down;
      const hasVisualFx =
        sparksAliveRef.current > 0 || engine.clearFlashTimer > 0 || engine.blastFlashTimer > 0;
      const needsFastFrame = !opts.lowPowerMode || hasHeldMotion || hasVisualFx;

      if (needsFastFrame) {
        rafId = requestAnimationFrame(stepAndSchedule);
      } else {
        // Low-Power sleep until next gravity drop / lock / callout expiry
        const wakeDelay = Math.min(240, engine.getNextWakeDelayMs());
        timeoutId = window.setTimeout(() => {
          timeoutId = 0;
          stepAndSchedule(performance.now());
        }, wakeDelay);
      }
    };

    const wake = () => {
      clearSchedules();
      lastTime = performance.now();
      const engine = engineRef.current;
      if (screenRef.current === 'playing' && engine && !engine.gameOver) {
        const h = heldRef.current;
        const opts = optionsRef.current;
        const hasVisualFx =
          sparksAliveRef.current > 0 ||
          engine.clearFlashTimer > 0 ||
          engine.blastFlashTimer > 0 ||
          engine.impactNonce !== lastImpactNonceRef.current;
        const needsFastFrame = !opts.lowPowerMode || h.moveDir !== 0 || h.down || hasVisualFx;
        if (needsFastFrame) {
          rafId = requestAnimationFrame(stepAndSchedule);
        } else {
          const wakeDelay = Math.min(240, engine.getNextWakeDelayMs());
          timeoutId = window.setTimeout(() => {
            timeoutId = 0;
            stepAndSchedule(performance.now());
          }, wakeDelay);
        }
      }
    };

    wakeLoopRef.current = wake;
    renderCanvas(true);
    wake();

    return () => {
      disposed = true;
      clearSchedules();
    };
  }, [screen, options.lowPowerMode, options.gridLines, options.ghostPiece, renderCanvas, syncHudIfChanged, triggerSound]);

  // Keyboard bindings with immediate 0ms render + Low-Power wake
  useEffect(() => {
    const clearHeld = () => {
      heldRef.current.left = false;
      heldRef.current.right = false;
      heldRef.current.down = false;
      heldRef.current.moveDir = 0;
      heldRef.current.dasTimerMs = 0;
      heldRef.current.arrTimerMs = 0;
      heldRef.current.softTimerMs = 0;
    };

    const immediateUpdate = () => {
      syncHudIfChanged();
      renderCanvas(false);
      wakeLoopRef.current();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (screenRef.current !== 'playing') return;
      const engine = engineRef.current!;
      if (engine.gameOver) return;

      const code = e.code;
      if (
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'ArrowDown' ||
        code === 'ArrowUp' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }

      if (code === 'Escape' || code === 'KeyP') {
        if (!e.repeat) {
          clearHeld();
          onPauseRef.current();
        }
        return;
      }

      if (code === 'ArrowLeft') {
        if (!e.repeat) {
          heldRef.current.left = true;
          heldRef.current.moveDir = -1;
          heldRef.current.dasTimerMs = 0;
          heldRef.current.arrTimerMs = 0;
          if (engine.move(-1)) triggerSound('move');
          immediateUpdate();
        }
        return;
      }

      if (code === 'ArrowRight') {
        if (!e.repeat) {
          heldRef.current.right = true;
          heldRef.current.moveDir = 1;
          heldRef.current.dasTimerMs = 0;
          heldRef.current.arrTimerMs = 0;
          if (engine.move(1)) triggerSound('move');
          immediateUpdate();
        }
        return;
      }

      if (code === 'ArrowDown') {
        if (!e.repeat) {
          heldRef.current.down = true;
          heldRef.current.softTimerMs = 0;
          if (engine.softDropStep()) triggerSound('softDrop');
          immediateUpdate();
        }
        return;
      }

      if (e.repeat) return;

      if (code === 'ArrowUp' || code === 'KeyX') {
        if (engine.rotate(1)) {
          triggerSound('rotate');
          immediateUpdate();
        }
      } else if (code === 'KeyZ' || code === 'ControlLeft' || code === 'ControlRight') {
        if (engine.rotate(-1)) {
          triggerSound('rotate');
          immediateUpdate();
        }
      } else if (code === 'KeyA' && optionsRef.current.allow180) {
        if (engine.rotate(2)) {
          triggerSound('rotate');
          immediateUpdate();
        }
      } else if (code === 'Space') {
        const ev = engine.hardDrop();
        triggerSound(ev);
        immediateUpdate();
        if (engine.gameOver) {
          onGameOverRef.current(engine.getSnapshot());
        }
      } else if (code === 'KeyC' || code === 'ShiftLeft' || code === 'ShiftRight') {
        if (engine.hold()) {
          triggerSound('hold');
          immediateUpdate();
        }
      } else if (code === 'KeyR') {
        engine.reset(Date.now() ^ 0x41c64e6d, optionsRef.current.startLevel);
        clearHeld();
        syncHudIfChanged(true);
        renderCanvas(true);
        wakeLoopRef.current();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft') {
        heldRef.current.left = false;
        heldRef.current.moveDir = heldRef.current.right ? 1 : 0;
        heldRef.current.dasTimerMs = 0;
      } else if (e.code === 'ArrowRight') {
        heldRef.current.right = false;
        heldRef.current.moveDir = heldRef.current.left ? -1 : 0;
        heldRef.current.dasTimerMs = 0;
      } else if (e.code === 'ArrowDown') {
        heldRef.current.down = false;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) clearHeld();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearHeld);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearHeld);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [renderCanvas, syncHudIfChanged, triggerSound]);

  // Touch action helpers (synchronous 0ms canvas update)
  const actMove = (dx: -1 | 1) => {
    if (screen !== 'playing') return;
    if (engineRef.current?.move(dx)) {
      triggerSound('move');
      renderCanvas(false);
    }
  };
  const actRotate = (dir: 1 | -1) => {
    if (screen !== 'playing') return;
    if (engineRef.current?.rotate(dir)) {
      triggerSound('rotate');
      renderCanvas(false);
    }
  };
  const actHold = () => {
    if (screen !== 'playing') return;
    if (engineRef.current?.hold()) {
      triggerSound('hold');
      syncHudIfChanged();
      renderCanvas(false);
    }
  };
  const actHardDrop = () => {
    if (screen !== 'playing') return;
    const engine = engineRef.current;
    if (!engine) return;
    const ev = engine.hardDrop();
    triggerSound(ev);
    syncHudIfChanged();
    renderCanvas(false);
    wakeLoopRef.current();
    if (engine.gameOver) {
      onGameOver(engine.getSnapshot());
    }
  };
  const actSoftDrop = () => {
    if (screen !== 'playing') return;
    if (engineRef.current?.softDropStep()) {
      triggerSound('softDrop');
      syncHudIfChanged();
      renderCanvas(false);
    }
  };
  const actRestart = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.reset(Date.now() ^ 0x41c64e6d, optionsRef.current.startLevel);
    syncHudIfChanged(true);
    renderCanvas(true);
    wakeLoopRef.current();
  };

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#040404] text-white"
      data-edition="no-color"
      data-low-power={options.lowPowerMode ? 'on' : 'off'}
    >
      {/* Static Monochrome Rocky Cave & Hill Cliff Backdrop (zero animation/CPU draw, No Color only) */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {/* Distant stepped mountain / cavern ridges */}
        <polygon points="0,900 0,520 140,420 310,490 480,360 660,440 840,340 1050,460 1240,390 1440,510 1440,900" fill="#090909" />
        <polygon points="0,900 0,630 180,550 380,620 560,520 750,590 950,500 1160,600 1440,540 1440,900" fill="#0E0E0E" />
        {/* Left & Right jagged stone cave walls framing playfield */}
        <polygon points="0,0 390,0 320,160 365,330 275,510 340,710 295,900 0,900" fill="#0B0B0B" />
        <polygon points="0,0 240,0 185,200 225,400 155,610 215,900 0,900" fill="#131313" />
        <polygon points="1440,0 1050,0 1120,180 1075,350 1165,530 1095,730 1145,900 1440,900" fill="#0B0B0B" />
        <polygon points="1440,0 1200,0 1255,210 1215,420 1285,630 1225,900 1440,900" fill="#131313" />
        {/* Subtle stone cliff fracture lines */}
        <polyline points="240,0 185,200 225,400 155,610 215,900" fill="none" stroke="#202020" strokeWidth="1.5" />
        <polyline points="390,0 320,160 365,330 275,510 340,710 295,900" fill="none" stroke="#1C1C1C" strokeWidth="1" />
        <polyline points="1200,0 1255,210 1215,420 1285,630 1225,900" fill="none" stroke="#202020" strokeWidth="1.5" />
        <polyline points="1050,0 1120,180 1075,350 1165,530 1095,730 1145,900" fill="none" stroke="#1C1C1C" strokeWidth="1" />
      </svg>

      {/* Top-right compact restart + audio utilities */}
      <div className="pointer-events-auto absolute top-3 right-3 z-10 flex items-center gap-2 sm:top-4 sm:right-4">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Restart run"
          onClick={(e) => {
            e.currentTarget.blur();
            actRestart();
          }}
          className="flex h-10 w-10 items-center justify-center border border-neutral-700 bg-black text-white transition-colors hover:border-white focus-visible:outline-2 focus-visible:outline-white"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={options.soundEnabled ? 'Mute sound' : 'Unmute sound'}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleSound();
          }}
          className="flex h-10 w-10 items-center justify-center border border-neutral-700 bg-black text-white transition-colors hover:border-white focus-visible:outline-2 focus-visible:outline-white"
        >
          {options.soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-neutral-500" />}
        </button>
      </div>

      {/* Monochrome line-clear callout / edition header above playfield */}
      <div className="relative z-10 mb-2 flex h-6 items-center justify-center">
        {hud.lastCallout ? (
          <div
            data-testid="nc-callout"
            className="font-display text-xs font-extrabold tracking-[0.18em] text-white uppercase sm:text-sm"
          >
            {hud.lastCallout}
          </div>
        ) : (
          <div className="text-[11px] font-bold tracking-[0.2em] text-neutral-400">
            {hud.isSuperActive
              ? 'SUPER BLOCK ACTIVE'
              : hud.isNextSuper
                ? 'SUPER BLOCK NEXT'
                : `NO COLOR${options.lowPowerMode ? ' · LOW POWER' : ''}`}
          </div>
        )}
      </div>

      {/* Classic 3-column arcade stage */}
      <div className="relative z-10 flex items-start justify-center gap-1.5 px-2 sm:gap-5 sm:px-3">
        {/* Left Wing: HOLD + SCORE/LEVEL/LINES */}
        <div className="flex w-[72px] shrink-0 flex-col gap-2 sm:w-32 sm:gap-4">
          {/* HOLD box */}
          <div className="border-2 border-white bg-black p-1.5 sm:p-2.5">
            <div className="mb-1 text-center text-[10px] font-bold tracking-[0.16em] text-neutral-300 sm:mb-1.5 sm:text-[11px]">
              HOLD{hud.holdIsSuper ? ' ★' : ''}
            </div>
            <div className="flex h-11 items-center justify-center border border-neutral-800 bg-[#050505] sm:h-14">
              <div className="scale-75 sm:scale-100">
                <PiecePreview
                  edition="no-color"
                  pieceId={hud.holdId}
                  isSuper={hud.holdIsSuper}
                  dimmed={!hud.canHold}
                  size="sm"
                />
              </div>
            </div>
          </div>

          {/* SCORE / LEVEL / LINES / BEST + COMBO/B2B */}
          <div className="flex flex-col gap-2 border-2 border-white bg-black p-2 sm:gap-3 sm:p-3">
            <div className="text-center">
              <div className="text-[10px] font-bold tracking-[0.14em] text-neutral-400 sm:text-[11px]">SCORE</div>
              <div
                data-testid="nc-score"
                className="font-telemetry mt-0.5 text-base font-extrabold text-white sm:text-2xl"
              >
                {hud.score}
              </div>
            </div>
            <div className="h-px bg-neutral-800" />
            <div className="text-center">
              <div className="text-[10px] font-bold tracking-[0.14em] text-neutral-400 sm:text-[11px]">LEVEL</div>
              <div
                data-testid="nc-level"
                className="font-telemetry mt-0.5 text-sm font-bold text-white sm:text-xl"
              >
                {hud.level}
              </div>
            </div>
            <div className="h-px bg-neutral-800" />
            <div className="text-center">
              <div className="text-[10px] font-bold tracking-[0.14em] text-neutral-400 sm:text-[11px]">LINES</div>
              <div
                data-testid="nc-lines"
                className="font-telemetry mt-0.5 text-sm font-bold text-white sm:text-xl"
              >
                {hud.lines}
              </div>
            </div>
            <div className="h-px bg-neutral-800" />
            <div className="text-center">
              <div className="text-[9px] font-bold tracking-[0.14em] text-neutral-500 sm:text-[10px]">BEST</div>
              <div className="font-telemetry mt-0.5 text-xs font-bold text-neutral-300 sm:text-sm">
                {hud.bestScore}
              </div>
            </div>

            <div className="hidden grid-cols-2 gap-1 border-t border-neutral-800 pt-2 sm:grid">
              <div className="text-center">
                <div className="text-[9px] font-bold tracking-wider text-neutral-500">COMBO</div>
                <div className="font-telemetry text-xs font-bold text-white">
                  {hud.combo > 0 ? `${hud.combo}x` : '0'}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[9px] font-bold tracking-wider text-neutral-500">B2B</div>
                <div className={`font-telemetry text-xs font-bold ${hud.b2b ? 'text-white' : 'text-neutral-500'}`}>
                  {hud.b2b ? 'ON' : 'OFF'}
                </div>
              </div>
            </div>

            {(hud.isSuperActive || hud.isNextSuper || hud.superBlasts > 0) && (
              <div className="hidden items-center justify-between border-t border-neutral-800 pt-1.5 text-[10px] sm:flex">
                <span className="font-bold tracking-wider text-neutral-400">
                  {hud.isSuperActive ? 'SUPER' : hud.isNextSuper ? 'READY' : 'BLASTS'}
                </span>
                <span className="font-telemetry font-bold text-white">
                  {hud.isSuperActive ? '5x5' : hud.isNextSuper ? 'NEXT' : hud.superBlasts}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Center Playfield Bezel */}
        <div className="relative shrink-0 border-2 border-white bg-black p-0.5 sm:border-4 sm:p-1">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            data-testid="nc-canvas"
            className="block h-[380px] w-[190px] sm:h-[560px] sm:w-[280px]"
          />
        </div>

        {/* Right Wing: NEXT queue + Pause button */}
        <div className="flex w-[72px] shrink-0 flex-col justify-between self-stretch sm:w-32">
          <div className="border-2 border-white bg-black p-1.5 sm:p-2.5">
            <div className="mb-1.5 text-center text-[10px] font-bold tracking-[0.16em] text-neutral-300 sm:mb-2 sm:text-[11px]">
              NEXT{hud.isNextSuper ? ' ★' : ''}
            </div>
            <div className="flex flex-col items-center gap-1 border border-neutral-800 bg-[#050505] py-1.5 sm:gap-2 sm:py-2">
              {hud.nextIds.map((pid, idx) => (
                <div key={idx} className={`scale-75 sm:scale-100 ${idx === 0 ? 'opacity-100' : 'opacity-75'}`}>
                  <PiecePreview
                    edition="no-color"
                    pieceId={pid}
                    isSuper={idx === 0 && hud.isNextSuper}
                    size={idx === 0 ? 'md' : 'sm'}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-3">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause game"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="flex h-11 w-11 items-center justify-center border-2 border-white bg-black text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-white sm:h-12 sm:w-12"
            >
              <Pause className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Touch Controls */}
      <div className="relative z-10 mt-3 flex w-full max-w-md items-center justify-between gap-2 px-4 md:hidden">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => actMove(-1)}
            className="flex h-11 w-11 items-center justify-center border border-white bg-black text-sm font-bold text-white active:bg-white active:text-black"
            aria-label="Move left"
          >
            ←
          </button>
          <button
            type="button"
            onClick={actSoftDrop}
            className="flex h-11 w-11 items-center justify-center border border-white bg-black text-sm font-bold text-white active:bg-white active:text-black"
            aria-label="Soft drop"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => actMove(1)}
            className="flex h-11 w-11 items-center justify-center border border-white bg-black text-sm font-bold text-white active:bg-white active:text-black"
            aria-label="Move right"
          >
            →
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={actHold}
            className="flex h-11 items-center justify-center border border-neutral-500 bg-black px-3 text-xs font-bold text-white active:bg-white active:text-black"
          >
            HOLD
          </button>
          <button
            type="button"
            onClick={() => actRotate(1)}
            className="flex h-11 w-11 items-center justify-center border border-white bg-black text-sm font-bold text-white active:bg-white active:text-black"
            aria-label="Rotate clockwise"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={actHardDrop}
            className="flex h-11 items-center justify-center border-2 border-white bg-white px-3 text-xs font-extrabold text-black active:bg-neutral-300"
          >
            DROP
          </button>
        </div>
      </div>
    </div>
  );
};
