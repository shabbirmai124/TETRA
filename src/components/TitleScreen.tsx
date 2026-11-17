import React, { useEffect, useRef } from 'react';
import { ColorMode, Edition } from '../types/game';
import { COLOR_PIECE_THEMES } from '../../color/engine';

interface TitleScreenProps {
  edition: Edition;
  colorMode: ColorMode;
  onSelectEdition: (edition: Edition) => void;
  onSelectColorMode: (mode: ColorMode) => void;
  onStart: () => void;
}

const COLOR_MODE_OPTIONS: { id: ColorMode; label: string; sub: string }[] = [
  { id: 'marathon', label: 'Marathon', sub: '150 Lines' },
  { id: 'sprint', label: 'Sprint 40L', sub: 'Speed Run' },
  { id: 'ultra', label: 'Ultra 2:00', sub: 'Time Attack' },
  { id: 'zen', label: 'Zen', sub: 'Endless' },
];

// Lightweight ambient centerpiece board animation (zero GC, respects edition palette)
const AmbientBoardPreview: React.FC<{ edition: Edition }> = ({ edition }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const editionRef = useRef(edition);
  editionRef.current = edition;

  useEffect(() => {
    let dropOffset = 0;

    // Static decorative stack + falling showcase pieces
    const stack: number[][] = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 3, 0, 0, 0, 0, 0],
      [0, 0, 0, 3, 3, 3, 0, 0, 0, 1],
      [6, 0, 0, 4, 4, 0, 2, 2, 0, 1],
      [6, 6, 6, 4, 4, 5, 2, 2, 0, 1],
      [7, 7, 5, 5, 3, 5, 5, 6, 0, 1],
      [7, 3, 3, 5, 3, 3, 6, 6, 6, 7],
    ];

    const cell = 24;
    const w = 10 * cell;
    const h = 20 * cell;

    let timerId = 0;
    let dropRow = 0;
    let bgCache: HTMLCanvasElement | null = null;

    const drawBlock = (ctx: CanvasRenderingContext2D, gx: number, gy: number, id: number, isMono: boolean) => {
      const x = gx * cell;
      const y = gy * cell;
      if (isMono) {
        ctx.fillStyle = '#050505';
        ctx.fillRect(x, y, cell, cell);
        ctx.fillStyle = '#171717';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(x + 1, y + 1, cell - 2, 1.5);
        ctx.fillRect(x + 1, y + 1, 1.5, cell - 2);
        ctx.fillStyle = '#8A8A8A';
        ctx.fillRect(x + 1, y + cell - 2, cell - 2, 1);
        ctx.fillRect(x + cell - 2, y + 1, 1, cell - 2);
        ctx.strokeStyle = '#D4D4D4';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 4.5, y + 4.5, cell - 9, cell - 9);
        ctx.fillStyle = '#525252';
        ctx.fillRect(x + 5, y + 11.5, cell - 10, 1);
        ctx.fillRect(x + 11.5, y + 5, 1, cell - 10);
      } else {
        const t = COLOR_PIECE_THEMES[id];
        if (!t) return;
        ctx.fillStyle = '#070A12';
        ctx.fillRect(x, y, cell, cell);
        ctx.fillStyle = t.fill;
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath();
        ctx.moveTo(x + 1, y + 1);
        ctx.lineTo(x + cell - 1, y + 1);
        ctx.lineTo(x + 1, y + cell - 1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = t.light;
        ctx.fillRect(x + 1, y + 1, cell - 2, 3);
        ctx.fillRect(x + 1, y + 1, 3, cell - 2);
        ctx.fillStyle = t.dark;
        ctx.fillRect(x + 1, y + cell - 4, cell - 2, 3);
        ctx.fillRect(x + cell - 4, y + 1, 3, cell - 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 5.5, y + 5.5, cell - 11, cell - 11);
      }
    };

    const ensureBgCache = (isMono: boolean): HTMLCanvasElement => {
      if (bgCache) return bgCache;
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d', { alpha: false });
      if (octx) {
        octx.fillStyle = isMono ? '#000000' : '#0D1017';
        octx.fillRect(0, 0, w, h);
        octx.strokeStyle = isMono ? '#191919' : '#181E2B';
        octx.lineWidth = 1;
        octx.beginPath();
        for (let c = 1; c < 10; c++) {
          octx.moveTo(c * cell + 0.5, 0);
          octx.lineTo(c * cell + 0.5, h);
        }
        for (let r = 1; r < 20; r++) {
          octx.moveTo(0, r * cell + 0.5);
          octx.lineTo(w, r * cell + 0.5);
        }
        octx.stroke();
        for (let r = 0; r < 20; r++) {
          for (let c = 0; c < 10; c++) {
            const id = stack[r][c];
            if (id !== 0) drawBlock(octx, c, r, id, isMono);
          }
        }
      }
      bgCache = off;
      return off;
    };

    const drawFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      const isMono = editionRef.current === 'no-color';

      ctx.drawImage(ensureBgCache(isMono), 0, 0);

      const fallY = dropRow;
      drawBlock(ctx, 4, fallY, 3, isMono);
      drawBlock(ctx, 3, fallY + 1, 3, isMono);
      drawBlock(ctx, 4, fallY + 1, 3, isMono);
      drawBlock(ctx, 5, fallY + 1, 3, isMono);
    };

    const tickPreview = () => {
      dropRow = (dropRow + 1) % 10;
      drawFrame();
      timerId = window.setTimeout(tickPreview, 420);
    };

    drawFrame();
    timerId = window.setTimeout(tickPreview, 420);
    return () => {
      if (timerId) window.clearTimeout(timerId);
    };
  }, [edition]);

  return (
    <div
      className={
        edition === 'no-color'
          ? 'border-4 border-white bg-black p-1'
          : 'rounded-2xl border-2 border-slate-400 bg-slate-700 p-2'
      }
    >
      <div className={edition === 'no-color' ? '' : 'overflow-hidden rounded-lg border-2 border-slate-950'}>
        <canvas ref={canvasRef} width={240} height={480} className="block h-[340px] w-[170px] sm:h-[420px] sm:w-[210px]" />
      </div>
    </div>
  );
};

export const TitleScreen: React.FC<TitleScreenProps> = ({
  edition,
  colorMode,
  onSelectEdition,
  onSelectColorMode,
  onStart,
}) => {
  const isMono = edition === 'no-color';

  // Enter / Space starts gameplay from Title Screen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onStart]);

  return (
    <main
      className={`relative flex h-full w-full flex-col justify-between overflow-hidden px-6 py-6 sm:px-12 sm:py-8 ${
        isMono ? 'bg-[#040404] text-white' : 'bg-[#0C101B] text-slate-100'
      }`}
      data-edition={edition}
    >
      {/* Static monochrome rocky cave & hill backdrop (No Color edition only) */}
      {isMono && (
        <svg
          aria-hidden="true"
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <polygon points="0,900 0,520 140,420 310,490 480,360 660,440 840,340 1050,460 1240,390 1440,510 1440,900" fill="#090909" />
          <polygon points="0,900 0,630 180,550 380,620 560,520 750,590 950,500 1160,600 1440,540 1440,900" fill="#0E0E0E" />
          <polygon points="1440,0 1060,0 1130,190 1085,360 1175,540 1105,740 1155,900 1440,900" fill="#0B0B0B" />
          <polyline points="1060,0 1130,190 1085,360 1175,540 1105,740 1155,900" fill="none" stroke="#1E1E1E" strokeWidth="1.5" />
        </svg>
      )}

      {/* Top spacer */}
      <div className="relative z-10 h-2" aria-hidden="true" />

      {/* Main asymmetric two-column stage: Left Lockup & Controls over negative space, Right Live Board */}
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-8 md:flex-row md:gap-12">
        {/* Left: Bespoke SVG Emblem, Edition Selector, Mode Options, Start CTA */}
        <div className="flex w-full max-w-md flex-col items-center text-center md:items-start md:text-left">
          {/* Bespoke inline SVG Title Lockup */}
          <div className="mb-6">
            <svg
              viewBox="0 0 320 68"
              className="h-14 w-auto sm:h-16"
              role="img"
              aria-label="TETRA"
            >
              {/* Geometric tetromino emblem */}
              <g transform="translate(0, 6)">
                <rect x="0" y="0" width="16" height="16" fill={isMono ? '#FFFFFF' : '#06B6D4'} />
                <rect x="18" y="0" width="16" height="16" fill={isMono ? '#FFFFFF' : '#A855F7'} />
                <rect x="36" y="0" width="16" height="16" fill={isMono ? '#FFFFFF' : '#EAB308'} />
                <rect x="18" y="18" width="16" height="16" fill={isMono ? '#FFFFFF' : '#22C55E'} />
                <rect x="18" y="36" width="16" height="16" fill={isMono ? '#FFFFFF' : '#EF4444'} />
              </g>
              <text
                x="68"
                y="49"
                fill={isMono ? '#FFFFFF' : '#F8FAFC'}
                fontFamily="Archivo, sans-serif"
                fontWeight="800"
                fontSize="48"
                letterSpacing="4"
              >
                TETRA
              </text>
            </svg>
          </div>

          {/* Two Individual Editions: No Color vs Color */}
          <div className="mb-5 w-full">
            <div
              className={`mb-2 text-xs font-bold tracking-[0.16em] ${
                isMono ? 'text-neutral-400' : 'text-slate-400'
              }`}
            >
              SELECT EDITION
            </div>
            <div className="grid grid-cols-2 gap-3" role="group" aria-label="Game edition">
              <button
                type="button"
                onClick={() => onSelectEdition('no-color')}
                aria-pressed={edition === 'no-color'}
                className={`flex flex-col items-start border-2 px-4 py-3 text-left transition-colors focus-visible:outline-2 ${
                  edition === 'no-color'
                    ? 'border-white bg-white text-black'
                    : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500'
                }`}
              >
                <span className="text-base font-extrabold whitespace-nowrap">No Color</span>
                <span
                  className={`mt-0.5 text-xs ${
                    edition === 'no-color' ? 'text-neutral-700' : 'text-slate-400'
                  }`}
                >
                  B&amp;W · Low Memory &amp; Power
                </span>
              </button>

              <button
                type="button"
                onClick={() => onSelectEdition('color')}
                aria-pressed={edition === 'color'}
                className={`flex flex-col items-start border-2 px-4 py-3 text-left transition-colors focus-visible:outline-2 ${
                  edition === 'color'
                    ? 'rounded-xl border-cyan-400 bg-slate-800 text-white'
                    : 'border-neutral-700 bg-black text-neutral-300 hover:border-neutral-500'
                }`}
              >
                <span className="text-base font-extrabold whitespace-nowrap">Color</span>
                <span
                  className={`mt-0.5 text-xs ${
                    edition === 'color' ? 'text-cyan-300' : 'text-neutral-400'
                  }`}
                >
                  SRS · T-Spin · 4 Modes
                </span>
              </button>
            </div>
          </div>

          {/* Color Mode Selector (only shown when Color edition is selected) */}
          {!isMono && (
            <div className="mb-6 w-full">
              <div className="mb-2 text-xs font-bold tracking-[0.16em] text-slate-400">MODE</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Color game mode">
                {COLOR_MODE_OPTIONS.map((m) => {
                  const active = colorMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectColorMode(m.id)}
                      aria-pressed={active}
                      className={`rounded-lg border px-2.5 py-2 text-center transition-colors ${
                        active
                          ? 'border-cyan-400 bg-cyan-500/15 text-white'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <div className="text-xs font-bold whitespace-nowrap">{m.label}</div>
                      <div className="text-[10px] text-slate-400 whitespace-nowrap">{m.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}


          {/* Primary Start CTA */}
          <button
            type="button"
            data-start="true"
            onClick={onStart}
            className={`w-full px-8 py-4 text-base font-extrabold tracking-wider uppercase sm:w-auto ${
              isMono
                ? 'border-2 border-white bg-white text-black hover:bg-neutral-200'
                : 'rounded-xl bg-emerald-500 text-slate-950 hover:bg-emerald-400'
            }`}
          >
            Start {isMono ? 'No Color' : 'Color'}
          </button>
        </div>

        {/* Right: Live Centerpiece Board */}
        <div className="hidden shrink-0 sm:block">
          <AmbientBoardPreview edition={edition} />
        </div>
      </div>

      {/* Single flat, borderless control-hint line in bottom safe margin */}
      <div
        className={`relative z-10 text-center text-xs tracking-wide ${
          isMono ? 'text-neutral-400' : 'text-slate-400'
        }`}
      >
        ← → Move · ↑ Rotate CW · Z Rotate CCW · Space Hard Drop · C Hold · Esc Pause
      </div>
    </main>
  );
};
