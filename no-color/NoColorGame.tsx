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
  const lastRenderSigRef = useRef('');
  const wakeLoopRef = useRef<() => void>(() => {});
  const gridCacheRef = useRef<{ canvas: HTMLCanvasElement; gridLines: boolean } | null>(null);

  const syncHudIfChanged = useCallback((force = false) => {
    const engine = engineRef.current;
    if (!engine) return;
    const snap = engine.getSnapshot();
    const sig = `${snap.score}|${snap.level}|${snap.lines}|${snap.combo}|${snap.b2b}|${snap.holdId}|${snap.canHold}|${snap.nextIds.join(',')}|${snap.lastCallout}|${snap.gameOver}`;
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
      ev === 'levelUp' ||
      ev === 'gameOver'
    ) {
      soundSynth.play(ev);
    }
  }, []);

  // Draw crisp pure monochrome cell (zero color channels)
  const drawMonoCell = (
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    isActive: boolean,
    lockAlpha: number,
  ) => {
    const x = gx * CELL_PX;
    const y = gy * CELL_PX;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x + 1, y + 1, CELL_PX - 2, CELL_PX - 2);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 5, y + 5, CELL_PX - 10, CELL_PX - 10);

    if (isActive && lockAlpha > 0.05) {
      const inset = 9;
      ctx.fillStyle = '#000000';
      ctx.fillRect(x + inset, y + inset, CELL_PX - inset * 2, CELL_PX - inset * 2);
    }
  };

  // Dirty-checked Canvas2D draw: skips redundant GPU uploads when state is unchanged
  const renderCanvas = useCallback((force = false) => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext('2d', { alpha: false });
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    const opts = optionsRef.current;
    const lockBucket = Math.floor(engine.getLockProgress() * 4);
    const flashActive = engine.clearFlashTimer > 0 ? 1 : 0;
    const sig = `${engine.boardRevision}|${lockBucket}|${flashActive}|${opts.gridLines ? 1 : 0}|${opts.ghostPiece ? 1 : 0}`;
    if (!force && sig === lastRenderSigRef.current) {
      return;
    }
    lastRenderSigRef.current = sig;

    // Blit pre-cached static background & grid lines in 1 call
    if (!gridCacheRef.current || gridCacheRef.current.gridLines !== opts.gridLines) {
      const off = gridCacheRef.current?.canvas ?? document.createElement('canvas');
      off.width = CANVAS_W;
      off.height = CANVAS_H;
      const octx = off.getContext('2d', { alpha: false });
      if (octx) {
        octx.fillStyle = '#000000';
        octx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        if (opts.gridLines) {
          octx.strokeStyle = '#1C1C1C';
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

    // Locked bitboard cells
    for (let r = NC_VISIBLE_START; r < NC_ROWS; r++) {
      const rowBits = engine.board[r];
      if (rowBits === 0) continue;
      const gy = r - NC_VISIBLE_START;
      for (let c = 0; c < NC_COLS; c++) {
        if ((rowBits & (1 << c)) !== 0) {
          drawMonoCell(ctx, c, gy, false, 0);
        }
      }
    }

    if (!engine.gameOver) {
      const mask = engine.getMask(engine.activeId, engine.activeRot);

      // Ghost piece outline (monochrome dashed outline)
      if (opts.ghostPiece && engine.ghostY !== engine.activeY) {
        ctx.save();
        ctx.strokeStyle = '#737373';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        for (let r = 0; r < 4; r++) {
          const rowNibble = (mask >>> (r << 2)) & 0xf;
          if (rowNibble === 0) continue;
          const gy = engine.ghostY + r - NC_VISIBLE_START;
          if (gy < 0 || gy >= VISIBLE_ROWS) continue;
          for (let c = 0; c < 4; c++) {
            if ((rowNibble & (1 << c)) === 0) continue;
            const gx = engine.activeX + c;
            ctx.strokeRect(gx * CELL_PX + 2.5, gy * CELL_PX + 2.5, CELL_PX - 5, CELL_PX - 5);
          }
        }
        ctx.restore();
      }

      // Active piece
      const lockProgress = engine.getLockProgress();
      for (let r = 0; r < 4; r++) {
        const rowNibble = (mask >>> (r << 2)) & 0xf;
        if (rowNibble === 0) continue;
        const gy = engine.activeY + r - NC_VISIBLE_START;
        if (gy < 0 || gy >= VISIBLE_ROWS) continue;
        for (let c = 0; c < 4; c++) {
          if ((rowNibble & (1 << c)) === 0) continue;
          const gx = engine.activeX + c;
          drawMonoCell(ctx, gx, gy, true, lockProgress);
        }
      }
    }

    // Line clear monochrome invert flash
    if (engine.clearFlashTimer > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  }, []);

  // Reset engine whenever runNonce increments
  useEffect(() => {
    if (runNonce === 0) return;
    const engine = engineRef.current!;
    engine.reset(Date.now() ^ (runNonce * 2654435761), optionsRef.current.startLevel);
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
      const needsFastFrame = !opts.lowPowerMode || hasHeldMotion || engine.clearFlashTimer > 0;

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
      if (screenRef.current === 'playing' && !engineRef.current?.gameOver) {
        const h = heldRef.current;
        const opts = optionsRef.current;
        const needsFastFrame =
          !opts.lowPowerMode || h.moveDir !== 0 || h.down || (engineRef.current?.clearFlashTimer ?? 0) > 0;
        if (needsFastFrame) {
          rafId = requestAnimationFrame(stepAndSchedule);
        } else {
          const wakeDelay = Math.min(240, engineRef.current?.getNextWakeDelayMs() ?? 200);
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
      className="relative flex h-full w-full flex-col items-center justify-center bg-[#090909] text-white"
      data-edition="no-color"
      data-low-power={options.lowPowerMode ? 'on' : 'off'}
    >
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
      <div className="mb-2 flex h-6 items-center justify-center">
        {hud.lastCallout ? (
          <div
            data-testid="nc-callout"
            className="font-display text-xs font-extrabold tracking-[0.18em] text-white uppercase sm:text-sm"
          >
            {hud.lastCallout}
          </div>
        ) : (
          <div className="text-[11px] font-bold tracking-[0.2em] text-neutral-400">
            NO COLOR{options.lowPowerMode ? ' · LOW POWER' : ''}
          </div>
        )}
      </div>

      {/* Classic 3-column arcade stage */}
      <div className="flex items-start justify-center gap-1.5 px-2 sm:gap-5 sm:px-3">
        {/* Left Wing: HOLD + SCORE/LEVEL/LINES */}
        <div className="flex w-[72px] shrink-0 flex-col gap-2 sm:w-32 sm:gap-4">
          {/* HOLD box */}
          <div className="border-2 border-white bg-black p-1.5 sm:p-2.5">
            <div className="mb-1 text-center text-[10px] font-bold tracking-[0.16em] text-neutral-300 sm:mb-1.5 sm:text-[11px]">
              HOLD
            </div>
            <div className="flex h-11 items-center justify-center border border-neutral-800 bg-[#050505] sm:h-14">
              <div className="scale-75 sm:scale-100">
                <PiecePreview edition="no-color" pieceId={hud.holdId} dimmed={!hud.canHold} size="sm" />
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
          </div>
        </div>

        {/* Center Playfield Bezel */}
        <div className="relative shrink-0 border-2 border-white bg-black p-0.5 shadow-[0_0_0_2px_#000] sm:border-4 sm:p-1">
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
              NEXT
            </div>
            <div className="flex flex-col items-center gap-1 border border-neutral-800 bg-[#050505] py-1.5 sm:gap-2 sm:py-2">
              {hud.nextIds.map((pid, idx) => (
                <div key={idx} className={`scale-75 sm:scale-100 ${idx === 0 ? 'opacity-100' : 'opacity-75'}`}>
                  <PiecePreview edition="no-color" pieceId={pid} size={idx === 0 ? 'md' : 'sm'} />
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
      <div className="mt-3 flex w-full max-w-md items-center justify-between gap-2 px-4 md:hidden">
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
