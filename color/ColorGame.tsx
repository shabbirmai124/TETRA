import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import {
  COLOR_PIECE_THEMES,
  C_COLS,
  C_ROWS,
  C_VISIBLE_START,
  ColorEngine,
  ColorMode,
  ColorSnapshot,
  ColorStepEvent,
  PARTICLE_POOL_CAP,
  PARTICLE_STRIDE,
} from './engine';
import { GameOptions, ScreenState } from '../src/types/game';
import { PiecePreview } from '../src/components/PiecePreview';
import { soundSynth } from '../src/audio/synth';

const BEST_SCORE_PREFIX = 'tetra_color_best_v1_';

const loadBestScore = (mode: ColorMode): number => {
  try {
    const raw = localStorage.getItem(`${BEST_SCORE_PREFIX}${mode}`);
    return raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
  } catch {
    return 0;
  }
};

const saveBestScore = (mode: ColorMode, score: number): void => {
  try {
    localStorage.setItem(`${BEST_SCORE_PREFIX}${mode}`, String(score));
  } catch {
    // Ignore storage quota issues
  }
};

const formatClock = (seconds: number): string => {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const tenths = Math.floor((clamped * 10) % 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
};

interface ColorGameProps {
  mode: ColorMode;
  screen: ScreenState;
  runNonce: number;
  options: GameOptions;
  onPause: () => void;
  onFinish: (snapshot: ColorSnapshot) => void;
  onToggleSound: () => void;
}

const VISIBLE_ROWS = C_ROWS - C_VISIBLE_START; // 20
const CELL_PX = 28;
const CANVAS_W = C_COLS * CELL_PX; // 280
const CANVAS_H = VISIBLE_ROWS * CELL_PX; // 560

export const ColorGame: React.FC<ColorGameProps> = ({
  mode,
  screen,
  runNonce,
  options,
  onPause,
  onFinish,
  onToggleSound,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const engineRef = useRef<ColorEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new ColorEngine(
      mode,
      Date.now() ^ 0x6c8e9cf5,
      loadBestScore(mode),
      options.startLevel,
    );
  }

  const [hud, setHud] = useState<ColorSnapshot>(() => engineRef.current!.getSnapshot());

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

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
  const lastRenderStateRef = useRef({ rev: -1, lockBucket: -1, optsBits: -1 });
  const wakeLoopRef = useRef<() => void>(() => {});
  const gridCacheRef = useRef<{ canvas: HTMLCanvasElement; gridLines: boolean } | null>(null);
  const atlasCacheRef = useRef<{ blocks: HTMLCanvasElement; ghosts: HTMLCanvasElement } | null>(null);

  const syncHudIfChanged = useCallback((force = false) => {
    const engine = engineRef.current;
    if (!engine) return;
    const snap = engine.getSnapshot();
    const clockBucket = Math.floor(snap.elapsedSec * 5); // 5Hz HUD clock refresh
    const sig = `${snap.mode}|${snap.score}|${snap.level}|${snap.lines}|${snap.combo}|${snap.b2b}|${snap.holdId}|${snap.holdIsSuper}|${snap.canHold}|${snap.isSuperActive}|${snap.isNextSuper}|${snap.superProgress}|${snap.superBlasts}|${snap.feverCharge}|${snap.isOverdrive}|${snap.rank}|${snap.nextIds.join(',')}|${snap.calloutId}|${snap.lastCallout}|${clockBucket}|${snap.gameOver}|${snap.victory}`;
    if (force || sig !== lastHudSigRef.current) {
      lastHudSigRef.current = sig;
      if (snap.bestScore > loadBestScore(snap.mode)) {
        saveBestScore(snap.mode, snap.bestScore);
      }
      setHud(snap);
    }
  }, []);

  const triggerSound = useCallback((ev: ColorStepEvent) => {
    if (!optionsRef.current.soundEnabled || ev === 'none' || ev === 'lock') return;
    const combo = Math.max(0, engineRef.current?.combo ?? 0);
    soundSynth.play(ev, combo);
  }, []);

  // Pre-bake 8 3D-cut Crystal Prism block & ghost sprites once into 224x28 atlases (7 pieces + slot 8 Super Diamond)
  const ensureSpriteAtlas = () => {
    if (atlasCacheRef.current) return atlasCacheRef.current;
    const blocks = document.createElement('canvas');
    blocks.width = CELL_PX * 8;
    blocks.height = CELL_PX;
    const bctx = blocks.getContext('2d');

    const ghosts = document.createElement('canvas');
    ghosts.width = CELL_PX * 8;
    ghosts.height = CELL_PX;
    const gctx = ghosts.getContext('2d');

    const s = CELL_PX;
    for (let id = 1; id <= 8; id++) {
      const theme = COLOR_PIECE_THEMES[id];
      if (!theme) continue;
      const x = (id - 1) * s;

      if (bctx) {
        const inset = 7;
        // Deep obsidian outer housing
        bctx.fillStyle = '#05080F';
        bctx.fillRect(x, 0, s, s);
        // Radiant diamond base
        bctx.fillStyle = theme.fill;
        bctx.fillRect(x + 1, 1, s - 2, s - 2);

        // Top cut diamond facet (bright specular)
        bctx.fillStyle = theme.light;
        bctx.beginPath();
        bctx.moveTo(x + 1, 1);
        bctx.lineTo(x + s - 1, 1);
        bctx.lineTo(x + s - inset, inset);
        bctx.lineTo(x + inset, inset);
        bctx.closePath();
        bctx.fill();

        // Top white gleam edge
        bctx.fillStyle = 'rgba(255,255,255,0.62)';
        bctx.fillRect(x + 2, 1, s - 4, 2);

        // Left cut diamond facet (light catch)
        bctx.fillStyle = theme.light;
        bctx.globalAlpha = 0.72;
        bctx.beginPath();
        bctx.moveTo(x + 1, 1);
        bctx.lineTo(x + inset, inset);
        bctx.lineTo(x + inset, s - inset);
        bctx.lineTo(x + 1, s - 1);
        bctx.closePath();
        bctx.fill();
        bctx.globalAlpha = 1;

        // Right cut diamond facet (mid-dark depth)
        bctx.fillStyle = theme.dark;
        bctx.globalAlpha = 0.65;
        bctx.beginPath();
        bctx.moveTo(x + s - 1, 1);
        bctx.lineTo(x + s - 1, s - 1);
        bctx.lineTo(x + s - inset, s - inset);
        bctx.lineTo(x + s - inset, inset);
        bctx.closePath();
        bctx.fill();
        bctx.globalAlpha = 1;

        // Bottom cut diamond facet (deep shadow)
        bctx.fillStyle = theme.dark;
        bctx.beginPath();
        bctx.moveTo(x + 1, s - 1);
        bctx.lineTo(x + s - 1, s - 1);
        bctx.lineTo(x + s - inset, s - inset);
        bctx.lineTo(x + inset, s - inset);
        bctx.closePath();
        bctx.fill();

        // Crisp diagonal diamond corner cut ribs
        bctx.strokeStyle = 'rgba(255,255,255,0.45)';
        bctx.lineWidth = 1;
        bctx.beginPath();
        bctx.moveTo(x + 1, 1);
        bctx.lineTo(x + inset, inset);
        bctx.moveTo(x + s - 1, 1);
        bctx.lineTo(x + s - inset, inset);
        bctx.moveTo(x + 1, s - 1);
        bctx.lineTo(x + inset, s - inset);
        bctx.moveTo(x + s - 1, s - 1);
        bctx.lineTo(x + s - inset, s - inset);
        bctx.stroke();

        // Center diamond jewel table + crystal glint triangle
        bctx.fillStyle = theme.fill;
        bctx.fillRect(x + inset, inset, s - inset * 2, s - inset * 2);
        bctx.fillStyle = 'rgba(255,255,255,0.38)';
        bctx.beginPath();
        bctx.moveTo(x + inset, inset);
        bctx.lineTo(x + s - inset, inset);
        bctx.lineTo(x + inset, s - inset);
        bctx.closePath();
        bctx.fill();
        bctx.strokeStyle = 'rgba(255,255,255,0.72)';
        bctx.strokeRect(x + inset + 0.5, inset + 0.5, s - inset * 2 - 1, s - inset * 2 - 1);

        // Top-left crystal star glint (extra bold 4-point diamond for Slot 8 Super Block)
        bctx.fillStyle = '#FFFFFF';
        bctx.fillRect(x + 2, 2, 3, 3);
        if (id === 8) {
          bctx.beginPath();
          bctx.moveTo(x + s / 2, 6);
          bctx.lineTo(x + s - 6, s / 2);
          bctx.lineTo(x + s / 2, s - 6);
          bctx.lineTo(x + 6, s / 2);
          bctx.closePath();
          bctx.fill();
        }
      }

      if (gctx) {
        gctx.fillStyle = theme.glow;
        gctx.fillRect(x + 2, 2, s - 4, s - 4);
        gctx.strokeStyle = theme.light;
        gctx.lineWidth = 1;
        gctx.strokeRect(x + 2.5, 2.5, s - 5, s - 5);
      }
    }

    atlasCacheRef.current = { blocks, ghosts };
    return atlasCacheRef.current;
  };

  // Zero-allocation dirty-checked Canvas2D sprite-sheet renderer
  const renderCanvas = useCallback((force = false, now = performance.now()) => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext('2d', { alpha: false });
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    const opts = optionsRef.current;
    const hasFx = engine.hasActiveVisualEffects();
    const lockBucket = Math.floor(engine.getLockProgress() * 4);
    const optsBits =
      (opts.gridLines ? 1 : 0) |
      (opts.ghostPiece ? 2 : 0) |
      (engine.gameOver ? 4 : 0) |
      (engine.victory ? 8 : 0) |
      (engine.isSuperActive ? 16 : 0);
    const prev = lastRenderStateRef.current;

    if (
      !force &&
      !hasFx &&
      prev.rev === engine.boardRevision &&
      prev.lockBucket === lockBucket &&
      prev.optsBits === optsBits
    ) {
      return;
    }
    prev.rev = engine.boardRevision;
    prev.lockBucket = lockBucket;
    prev.optsBits = optsBits;

    const hasShake = engine.shakeTrauma > 0.005;
    if (hasShake) {
      ctx.save();
      const mag = engine.shakeTrauma * engine.shakeTrauma * 5.5;
      const sx = Math.round(Math.sin(now * 0.09) * mag);
      const sy = Math.round(Math.cos(now * 0.13) * mag);
      ctx.fillStyle = '#0D1017';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.translate(sx, sy);
    }

    // Blit pre-cached obsidian well + static grid lines in 1 call
    if (!gridCacheRef.current || gridCacheRef.current.gridLines !== opts.gridLines) {
      const off = gridCacheRef.current?.canvas ?? document.createElement('canvas');
      off.width = CANVAS_W;
      off.height = CANVAS_H;
      const octx = off.getContext('2d', { alpha: false });
      if (octx) {
        octx.fillStyle = '#0D1017';
        octx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        if (opts.gridLines) {
          octx.strokeStyle = '#181E2B';
          octx.lineWidth = 1;
          octx.beginPath();
          for (let c = 1; c < C_COLS; c++) {
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

    const atlas = ensureSpriteAtlas();

    // Locked board cells (integer 28x28 sprite-sheet blits)
    for (let r = C_VISIBLE_START; r < C_ROWS; r++) {
      const py = (r - C_VISIBLE_START) * CELL_PX;
      const rowOff = r * C_COLS;
      for (let c = 0; c < C_COLS; c++) {
        const cid = engine.board[rowOff + c];
        if (cid !== 0) {
          ctx.drawImage(atlas.blocks, (cid - 1) * CELL_PX, 0, CELL_PX, CELL_PX, c * CELL_PX, py, CELL_PX, CELL_PX);
        }
      }
    }

    if (!engine.gameOver && !engine.victory) {
      const mask = engine.getMask(engine.activeId, engine.activeRot);
      const sx = ((engine.isSuperActive ? 8 : engine.activeId) - 1) * CELL_PX;

      // Ghost piece (sprite-sheet blit)
      if (opts.ghostPiece && engine.ghostY !== engine.activeY && engine.activeId >= 1) {
        for (let r = 0; r < 4; r++) {
          const rowNibble = (mask >>> (r << 2)) & 0xf;
          if (rowNibble === 0) continue;
          const gy = engine.ghostY + r - C_VISIBLE_START;
          if (gy < 0 || gy >= VISIBLE_ROWS) continue;
          const py = gy * CELL_PX;
          for (let c = 0; c < 4; c++) {
            if ((rowNibble & (1 << c)) === 0) continue;
            ctx.drawImage(atlas.ghosts, sx, 0, CELL_PX, CELL_PX, (engine.activeX + c) * CELL_PX, py, CELL_PX, CELL_PX);
          }
        }
      }

      // Active piece (sprite-sheet blit + optional lock highlight)
      const lockAlpha = lockBucket > 0 ? Math.min(0.42, (lockBucket / 4) * 0.42) : 0;
      for (let r = 0; r < 4; r++) {
        const rowNibble = (mask >>> (r << 2)) & 0xf;
        if (rowNibble === 0) continue;
        const gy = engine.activeY + r - C_VISIBLE_START;
        if (gy < 0 || gy >= VISIBLE_ROWS) continue;
        const py = gy * CELL_PX;
        for (let c = 0; c < 4; c++) {
          if ((rowNibble & (1 << c)) === 0) continue;
          const px = (engine.activeX + c) * CELL_PX;
          ctx.drawImage(atlas.blocks, sx, 0, CELL_PX, CELL_PX, px, py, CELL_PX, CELL_PX);
          if (lockAlpha > 0) {
            ctx.fillStyle = `rgba(255, 255, 255, ${lockAlpha})`;
            ctx.fillRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2);
          }
        }
      }
    }

    // Line-clear fiery white-gold horizontal beam + radial starburst flare
    if (engine.lineClearFlashTimer > 0) {
      const t = Math.min(1, engine.lineClearFlashTimer / 0.26);
      let firstRowPy = -1;
      let lastRowPy = -1;
      for (let r = C_VISIBLE_START; r < C_ROWS; r++) {
        if (engine.clearingRows[r] === 1) {
          const py = (r - C_VISIBLE_START) * CELL_PX;
          if (firstRowPy < 0) firstRowPy = py;
          lastRowPy = py;
          ctx.fillStyle = `rgba(249, 115, 22, ${t * 0.42})`;
          ctx.fillRect(0, py + 2, CANVAS_W, CELL_PX - 4);
          ctx.fillStyle = `rgba(254, 240, 138, ${t * 0.72})`;
          ctx.fillRect(0, py + 6, CANVAS_W, CELL_PX - 12);
          ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, t * 1.15)})`;
          ctx.fillRect(0, py + Math.floor(CELL_PX / 2) - 3, CANVAS_W, 6);
        }
      }
      if (firstRowPy >= 0) {
        const cx = Math.round(engine.lastImpactX * CELL_PX);
        const cy = Math.round((firstRowPy + lastRowPy + CELL_PX) * 0.5);
        const rayLen = 28 + t * 48;
        ctx.strokeStyle = `rgba(254, 240, 138, ${t * 0.9})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx - rayLen * 1.35, cy);
        ctx.lineTo(cx + rayLen * 1.35, cy);
        ctx.moveTo(cx, cy - rayLen * 0.95);
        ctx.lineTo(cx, cy + rayLen * 0.95);
        ctx.stroke();

        ctx.strokeStyle = `rgba(255, 255, 255, ${t})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - rayLen * 1.45, cy);
        ctx.lineTo(cx + rayLen * 1.45, cy);
        ctx.moveTo(cx, cy - rayLen);
        ctx.lineTo(cx, cy + rayLen);
        ctx.moveTo(cx - rayLen * 0.65, cy - rayLen * 0.65);
        ctx.lineTo(cx + rayLen * 0.65, cy + rayLen * 0.65);
        ctx.moveTo(cx - rayLen * 0.65, cy + rayLen * 0.65);
        ctx.lineTo(cx + rayLen * 0.65, cy - rayLen * 0.65);
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - 5, cy - 5, 10, 10);
      }
    }

    // 5x5 Super Blast fiery shockwave ring + starburst flare
    if (engine.blastFlashTimer > 0) {
      const bt = Math.min(1, engine.blastFlashTimer / 0.28);
      const bx = Math.round(engine.lastImpactX * CELL_PX);
      const by = Math.round(engine.lastImpactY * CELL_PX);
      const radius = Math.round((1 - bt) * 88 + 18);
      ctx.strokeStyle = `rgba(251, 146, 60, ${bt * 0.85})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${bt})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(8, radius - 4), 0, Math.PI * 2);
      const flare = 26 + bt * 54;
      ctx.moveTo(bx - flare, by);
      ctx.lineTo(bx + flare, by);
      ctx.moveTo(bx, by - flare);
      ctx.lineTo(bx, by + flare);
      ctx.stroke();
    }

    // Zero-GC pooled fire-spark streaks & crystal shards
    if (engine.activeParticlesCount > 0) {
      for (let i = 0; i < PARTICLE_POOL_CAP; i++) {
        const idx = i * PARTICLE_STRIDE;
        const life = engine.particles[idx + 4];
        if (life <= 0) continue;
        const maxLife = engine.particles[idx + 5] || 1;
        const alpha = Math.max(0, life / maxLife);
        const px = Math.round(engine.particles[idx] * CELL_PX);
        const py = Math.round(engine.particles[idx + 1] * CELL_PX);
        const vx = engine.particles[idx + 2];
        const vy = engine.particles[idx + 3];
        const colorId = engine.particles[idx + 6];

        if (colorId === 0) {
          // Fiery white-gold-orange ember streak (matching reference starburst)
          const tx = Math.round((engine.particles[idx] - vx * 0.028) * CELL_PX);
          const ty = Math.round((engine.particles[idx + 1] - vy * 0.028) * CELL_PX);
          ctx.strokeStyle = alpha > 0.68 ? '#FEF08A' : alpha > 0.35 ? '#F97316' : '#EA580C';
          ctx.lineWidth = alpha > 0.6 ? 2.5 : 1.5;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.fillStyle = alpha > 0.55 ? '#FFFFFF' : '#FDE047';
          ctx.fillRect(px - 1, py - 1, 3, 3);
        } else {
          const theme = COLOR_PIECE_THEMES[colorId];
          ctx.fillStyle = theme ? theme.light : '#FFFFFF';
          ctx.globalAlpha = alpha;
          const size = Math.round(2.5 + alpha * 2.5);
          ctx.fillRect(px - (size >> 1), py - (size >> 1), size, size);
        }
      }
      ctx.globalAlpha = 1;
    }

    if (hasShake) {
      ctx.restore();
    }
  }, []);

  // Reset engine on new run or mode change
  useEffect(() => {
    if (runNonce === 0 && engineRef.current?.mode === mode) return;
    const engine = engineRef.current!;
    engine.bestScore = loadBestScore(mode);
    engine.reset(mode, Date.now() ^ ((runNonce + 1) * 2654435761), optionsRef.current.startLevel);
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
  }, [runNonce, mode, syncHudIfChanged, renderCanvas]);

  // Adaptive Low-Power + 60fps FX Simulation Loop
  //   * Paused / Finished: 0% CPU (no timers or rAF scheduled).
  //   * Low-Power Idle (no held keys & no active particles/shake/flash): sleeps until exact next wake event.
  //   * Active Motion / Particle Burst: smooth 60fps rAF until effects settle.
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

      if (activeScreen !== 'playing' || engine.gameOver || engine.victory) {
        renderCanvas(false, now);
        return; // Sleep completely when paused or finished
      }

      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const maxDt = opts.lowPowerMode ? 0.25 : 0.05;
      const dt = Math.min(Math.max(0, rawDt), maxDt);

      const h = heldRef.current;
      if (h.moveDir !== 0) {
        h.dasTimerMs += dt * 1000;
        if (h.dasTimerMs >= opts.dasMs) {
          if (opts.arrMs <= 0) {
            while (engine.move(h.moveDir)) {
              // instant ARR
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
        const softIntervalMs = Math.max(10, 500 / Math.max(1, opts.sdf));
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
      syncHudIfChanged();
      renderCanvas(false, now);

      if (engine.gameOver || engine.victory) {
        const finalSnap = engine.getSnapshot();
        if (finalSnap.bestScore > loadBestScore(finalSnap.mode)) {
          saveBestScore(finalSnap.mode, finalSnap.bestScore);
        }
        onFinishRef.current(finalSnap);
        return;
      }

      const hasHeldMotion = h.moveDir !== 0 || h.down;
      const needsFastFrame = !opts.lowPowerMode || hasHeldMotion || engine.hasActiveVisualEffects();

      if (needsFastFrame) {
        rafId = requestAnimationFrame(stepAndSchedule);
      } else {
        const wakeDelay = Math.min(200, engine.getNextWakeDelayMs());
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
      if (screenRef.current === 'playing' && engine && !engine.gameOver && !engine.victory) {
        const h = heldRef.current;
        const opts = optionsRef.current;
        const needsFastFrame = !opts.lowPowerMode || h.moveDir !== 0 || h.down || engine.hasActiveVisualEffects();
        if (needsFastFrame) {
          rafId = requestAnimationFrame(stepAndSchedule);
        } else {
          const wakeDelay = Math.min(200, engine.getNextWakeDelayMs());
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
      if (engine.gameOver || engine.victory) return;

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
        if (engine.gameOver || engine.victory) {
          onFinishRef.current(engine.getSnapshot());
        }
      } else if (code === 'KeyC' || code === 'ShiftLeft' || code === 'ShiftRight') {
        if (engine.hold()) {
          triggerSound('hold');
          immediateUpdate();
        }
      } else if (code === 'KeyR') {
        engine.reset(modeRef.current, Date.now() ^ 0x9e3779b9, optionsRef.current.startLevel);
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

  // Mobile / click actions with synchronous 0ms canvas update
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
    if (engine.gameOver || engine.victory) {
      onFinish(engine.getSnapshot());
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
    engine.reset(modeRef.current, Date.now() ^ 0x9e3779b9, optionsRef.current.startLevel);
    syncHudIfChanged(true);
    renderCanvas(true);
    wakeLoopRef.current();
  };

  const modeLabel =
    hud.mode === 'marathon'
      ? 'MARATHON'
      : hud.mode === 'sprint'
      ? 'SPRINT 40L'
      : hud.mode === 'ultra'
      ? 'ULTRA 2:00'
      : 'ZEN';

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center bg-[#0C101B] text-slate-100"
      data-edition="color"
      data-low-power={options.lowPowerMode ? 'on' : 'off'}
    >
      {/* Top-right compact audio + quick restart */}
      <div className="pointer-events-auto absolute top-4 right-4 z-10 flex items-center gap-2">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Restart run"
          onClick={(e) => {
            e.currentTarget.blur();
            actRestart();
          }}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 transition-colors hover:border-slate-400 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400"
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
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 transition-colors hover:border-slate-400 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          {options.soundEnabled ? <Volume2 className="h-4 w-4 text-cyan-400" /> : <VolumeX className="h-4 w-4 text-slate-500" />}
        </button>
      </div>

      {/* Live callout ribbon positioned above the playfield without covering cells */}
      <div className="relative z-10 mb-2 flex h-7 items-center justify-center">
        {hud.lastCallout ? (
          <div
            data-testid="color-callout"
            className="font-display text-sm font-extrabold tracking-wider text-amber-300"
          >
            {hud.lastCallout}
          </div>
        ) : (
          <div className="text-xs font-bold tracking-[0.18em] text-slate-400">
            {hud.isSuperActive
              ? 'SUPER BLOCK ACTIVE'
              : hud.isNextSuper
                ? 'SUPER BLOCK NEXT'
                : `COLOR · ${modeLabel}${options.lowPowerMode ? ' · LOW POWER' : ''}`}
          </div>
        )}
      </div>

      {/* Crisp flat metallic 3-column arcade stage (zero CSS blur shadows/gradients) */}
      <div className="relative z-10 flex items-start justify-center gap-1.5 px-2 sm:gap-5 sm:px-3">
        {/* Left Wing: HOLD + SCORE / LEVEL / LINES + B2B/COMBO */}
        <div className="flex w-[72px] shrink-0 flex-col gap-2 sm:w-36 sm:gap-3.5">
          {/* HOLD metallic well */}
          <div className="rounded-xl border-2 border-slate-500 bg-slate-800 p-1.5 sm:p-2">
            <div className="mb-1 text-center text-[10px] font-extrabold tracking-[0.14em] text-slate-100 sm:mb-1.5 sm:text-[11px]">
              HOLD{hud.holdIsSuper ? ' ★' : ''}
            </div>
            <div className="flex h-11 items-center justify-center rounded-lg border border-slate-900 bg-[#0D1017] sm:h-14">
              <div className="scale-75 sm:scale-100">
                <PiecePreview
                  edition="color"
                  pieceId={hud.holdId}
                  isSuper={hud.holdIsSuper}
                  dimmed={!hud.canHold}
                  size="sm"
                />
              </div>
            </div>
          </div>

          {/* SCORE / LEVEL / LINES + Advanced Telemetry */}
          <div className="flex flex-col gap-1.5 rounded-xl border-2 border-slate-500 bg-slate-800 p-1.5 sm:gap-2.5 sm:p-2.5">
            <div className="rounded-md bg-[#0D1017] px-1.5 py-1 text-center sm:px-2 sm:py-1.5">
              <div className="text-[9px] font-bold tracking-[0.14em] text-slate-400 sm:text-[10px]">SCORE</div>
              <div
                data-testid="color-score"
                className="font-telemetry text-sm font-extrabold text-white sm:text-xl"
              >
                {hud.score}
              </div>
            </div>

            <div className="rounded-md bg-[#0D1017] px-1.5 py-1 text-center sm:px-2 sm:py-1.5">
              <div className="text-[9px] font-bold tracking-[0.14em] text-slate-400 sm:text-[10px]">
                {hud.mode === 'ultra' ? 'TIME LEFT' : 'LEVEL'}
              </div>
              <div
                data-testid="color-level"
                className="font-telemetry text-sm font-extrabold text-cyan-300 sm:text-lg"
              >
                {hud.mode === 'ultra' ? formatClock(hud.remainingSec) : hud.level}
              </div>
            </div>

            <div className="rounded-md bg-[#0D1017] px-1.5 py-1 text-center sm:px-2 sm:py-1.5">
              <div className="text-[9px] font-bold tracking-[0.14em] text-slate-400 sm:text-[10px]">
                {hud.mode === 'sprint' ? 'LINES LEFT' : 'LINES'}
              </div>
              <div
                data-testid="color-lines"
                className="font-telemetry text-sm font-extrabold text-emerald-300 sm:text-lg"
              >
                {hud.mode === 'sprint' ? Math.max(0, 40 - hud.lines) : hud.lines}
              </div>
            </div>

            <div className="hidden grid-cols-2 gap-1.5 sm:grid">
              <div className="rounded bg-[#0D1017] px-1.5 py-1 text-center">
                <div className="text-[9px] font-bold tracking-wider text-slate-400">COMBO</div>
                <div className="font-telemetry text-xs font-bold text-amber-300">
                  {hud.combo > 0 ? `${hud.combo}x` : '0'}
                </div>
              </div>
              <div className="rounded bg-[#0D1017] px-1.5 py-1 text-center">
                <div className="text-[9px] font-bold tracking-wider text-slate-400">B2B</div>
                <div className={`font-telemetry text-xs font-bold ${hud.b2b ? 'text-purple-300' : 'text-slate-500'}`}>
                  {hud.b2b ? 'ACTIVE' : 'OFF'}
                </div>
              </div>
            </div>

            <div className="hidden items-center justify-between px-1 text-[11px] text-slate-300 sm:flex">
              <span>PPS</span>
              <span className="font-telemetry font-bold">{hud.pps.toFixed(1)}</span>
            </div>
            <div className="hidden items-center justify-between px-1 text-[11px] text-slate-300 sm:flex">
              <span>T-SPINS</span>
              <span className="font-telemetry font-bold text-purple-300">{hud.tSpins}</span>
            </div>
            <div className="hidden items-center justify-between px-1 text-[11px] text-slate-300 sm:flex">
              <span>RANK</span>
              <span className="font-telemetry font-extrabold text-cyan-300">{hud.rank}</span>
            </div>
            <div className="hidden items-center justify-between px-1 text-[11px] text-amber-300 sm:flex">
              <span>{hud.isSuperActive ? 'SUPER' : hud.isNextSuper ? 'READY' : 'SUPER'}</span>
              <span className="font-telemetry font-bold">
                {hud.isSuperActive ? '5x5!' : hud.isNextSuper ? 'NEXT!' : `${hud.superProgress}/8`}
              </span>
            </div>
            {/* Overdrive 2X Rush Gauge */}
            <div className="hidden flex-col gap-1 rounded bg-[#0D1017] px-1.5 py-1 sm:flex">
              <div className="flex items-center justify-between text-[9px] font-bold tracking-wider">
                <span className={hud.isOverdrive ? 'text-amber-300' : 'text-slate-400'}>
                  {hud.isOverdrive ? '2X OVERDRIVE' : 'OVERDRIVE'}
                </span>
                <span className="font-telemetry text-white">{hud.feverCharge}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden bg-slate-800">
                <div
                  className={`h-full ${hud.isOverdrive ? 'bg-amber-400' : 'bg-cyan-400'}`}
                  style={{ width: `${Math.min(100, Math.max(0, hud.feverCharge))}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Center Metallic Beveled Playfield */}
        <div className="shrink-0 rounded-xl border-2 border-slate-400 bg-slate-700 p-1 sm:rounded-2xl sm:p-2">
          <div className="overflow-hidden rounded-lg border-2 border-slate-950 bg-[#0D1017]">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              data-testid="color-canvas"
              className="block h-[380px] w-[190px] sm:h-[560px] sm:w-[280px]"
            />
          </div>
        </div>

        {/* Right Wing: 5-Piece NEXT Queue + Bottom-Right Pause */}
        <div className="flex w-[72px] shrink-0 flex-col justify-between self-stretch sm:w-36">
          <div className="rounded-xl border-2 border-slate-500 bg-slate-800 p-1.5 sm:p-2.5">
            <div className="mb-1 text-center text-[10px] font-extrabold tracking-[0.14em] text-slate-100 sm:mb-2 sm:text-[11px]">
              NEXT{hud.isNextSuper ? ' ★' : ''}
            </div>
            <div className="flex flex-col items-center gap-0.5 rounded-lg border border-slate-900 bg-[#0D1017] py-1 sm:gap-1.5 sm:py-2">
              {hud.nextIds.map((pid, idx) => (
                <div
                  key={idx}
                  className={`scale-75 sm:scale-100 ${
                    idx === 0 ? 'opacity-100' : idx < 3 ? 'opacity-90' : 'hidden opacity-75 sm:block'
                  }`}
                >
                  <PiecePreview
                    edition="color"
                    pieceId={pid}
                    isSuper={idx === 0 && hud.isNextSuper}
                    size={idx === 0 ? 'md' : 'sm'}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 pt-3">
            <div className="hidden w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-center sm:block">
              <div className="text-[10px] font-bold tracking-wider text-slate-400">BEST</div>
              <div className="font-telemetry text-xs font-bold text-slate-200">{hud.bestScore}</div>
            </div>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause game"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-slate-500 bg-slate-700 text-white transition-colors hover:border-white hover:bg-slate-600 focus-visible:outline-2 focus-visible:outline-cyan-400 sm:h-12 sm:w-12"
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
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 text-sm font-bold text-white active:bg-slate-600"
            aria-label="Move left"
          >
            ←
          </button>
          <button
            type="button"
            onClick={actSoftDrop}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 text-sm font-bold text-white active:bg-slate-600"
            aria-label="Soft drop"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => actMove(1)}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 text-sm font-bold text-white active:bg-slate-600"
            aria-label="Move right"
          >
            →
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={actHold}
            className="flex h-11 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 px-3 text-xs font-bold text-slate-200 active:bg-slate-600"
          >
            HOLD
          </button>
          <button
            type="button"
            onClick={() => actRotate(1)}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-500/60 bg-slate-800 text-sm font-bold text-cyan-300 active:bg-slate-600"
            aria-label="Rotate clockwise"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={actHardDrop}
            className="flex h-11 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-extrabold text-white active:bg-emerald-500"
          >
            DROP
          </button>
        </div>
      </div>
    </div>
  );
};
