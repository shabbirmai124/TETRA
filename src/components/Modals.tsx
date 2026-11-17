import React, { useState } from 'react';
import { Edition, GameOptions } from '../types/game';
import { ColorSnapshot } from '../../color/engine';
import { NoColorSnapshot } from '../../no-color/engine';

interface PauseModalProps {
  edition: Edition;
  options: GameOptions;
  onUpdateOptions: (patch: Partial<GameOptions>) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

type PauseSubView = 'menu' | 'options' | 'howto';

export const PauseModal: React.FC<PauseModalProps> = ({
  edition,
  options,
  onUpdateOptions,
  onResume,
  onRestart,
  onQuit,
}) => {
  const [subView, setSubView] = useState<PauseSubView>('menu');
  const isMono = edition === 'no-color';

  const cardClass = isMono
    ? 'w-full max-w-sm border-4 border-white bg-black p-6 text-white shadow-2xl'
    : 'w-full max-w-sm rounded-2xl border-2 border-slate-300/75 bg-[#1C2029] p-6 text-white shadow-2xl';

  const primaryBtn = isMono
    ? 'w-full border-2 border-white bg-white py-3 text-sm font-extrabold tracking-widest text-black uppercase transition-colors hover:bg-neutral-200'
    : 'w-full rounded-lg border border-emerald-400/50 bg-emerald-600 py-3 text-sm font-extrabold tracking-widest text-white uppercase shadow transition-colors hover:bg-emerald-500';

  const secondaryBtn = isMono
    ? 'w-full border-2 border-neutral-500 bg-black py-2.5 text-sm font-bold tracking-widest text-white uppercase transition-colors hover:border-white'
    : 'w-full rounded-lg border border-slate-500/60 bg-slate-700/80 py-2.5 text-sm font-bold tracking-widest text-slate-100 uppercase transition-colors hover:bg-slate-600';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Game paused"
    >
      <div className={cardClass}>
        {subView === 'menu' && (
          <div className="flex flex-col items-center gap-3">
            <h2 className="mb-2 text-2xl font-extrabold tracking-[0.2em] uppercase">PAUSED</h2>
            <button type="button" onClick={onResume} className={primaryBtn}>
              Resume
            </button>
            <button type="button" onClick={() => setSubView('options')} className={secondaryBtn}>
              Options
            </button>
            <button type="button" onClick={() => setSubView('howto')} className={secondaryBtn}>
              How to Play
            </button>
            <button type="button" onClick={onRestart} className={secondaryBtn}>
              Restart
            </button>
            <button type="button" onClick={onQuit} className={secondaryBtn}>
              Quit
            </button>
          </div>
        )}

        {subView === 'options' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold tracking-wider uppercase">Options</h2>
              <button
                type="button"
                onClick={() => setSubView('menu')}
                className={`px-2.5 py-1 text-xs font-bold uppercase ${
                  isMono ? 'border border-white text-white' : 'rounded bg-slate-700 text-slate-200'
                }`}
              >
                Back
              </button>
            </div>

            <label className="flex items-center justify-between text-sm">
              <span>Ghost Piece</span>
              <input
                type="checkbox"
                checked={options.ghostPiece}
                onChange={(e) => onUpdateOptions({ ghostPiece: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between text-sm">
              <span>Matrix Grid Lines</span>
              <input
                type="checkbox"
                checked={options.gridLines}
                onChange={(e) => onUpdateOptions({ gridLines: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between text-sm">
              <span>Sound Effects</span>
              <input
                type="checkbox"
                checked={options.soundEnabled}
                onChange={(e) => onUpdateOptions({ soundEnabled: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between text-sm">
              <span>Low Power Mode (Idle Sleep)</span>
              <input
                type="checkbox"
                checked={options.lowPowerMode}
                onChange={(e) => onUpdateOptions({ lowPowerMode: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between text-sm">
              <span>180° Rotate (A Key)</span>
              <input
                type="checkbox"
                checked={options.allow180}
                onChange={(e) => onUpdateOptions({ allow180: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
            </label>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-neutral-300">
                <span>Start Level</span>
                <span className="font-telemetry">{options.startLevel}</span>
              </div>
              <input
                type="range"
                min={1}
                max={15}
                step={1}
                value={options.startLevel}
                onChange={(e) => onUpdateOptions({ startLevel: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-neutral-300">
                <span>DAS (Auto-Shift Delay)</span>
                <span className="font-telemetry">{options.dasMs} ms</span>
              </div>
              <input
                type="range"
                min={70}
                max={220}
                step={5}
                value={options.dasMs}
                onChange={(e) => onUpdateOptions({ dasMs: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-neutral-300">
                <span>ARR (Auto-Repeat Rate)</span>
                <span className="font-telemetry">{options.arrMs} ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={60}
                step={5}
                value={options.arrMs}
                onChange={(e) => onUpdateOptions({ arrMs: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-neutral-300">
                <span>SDF (Soft Drop Speed)</span>
                <span className="font-telemetry">{options.sdf}x</span>
              </div>
              <input
                type="range"
                min={4}
                max={40}
                step={2}
                value={options.sdf}
                onChange={(e) => onUpdateOptions({ sdf: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>
        )}

        {subView === 'howto' && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold tracking-wider uppercase">How to Play</h2>
              <button
                type="button"
                onClick={() => setSubView('menu')}
                className={`px-2.5 py-1 text-xs font-bold uppercase ${
                  isMono ? 'border border-white text-white' : 'rounded bg-slate-700 text-slate-200'
                }`}
              >
                Back
              </button>
            </div>
            <div className="space-y-1.5 text-xs leading-relaxed text-neutral-300">
              <div className="flex justify-between">
                <span>Move Left / Right</span>
                <span className="font-telemetry font-bold text-white">← / →</span>
              </div>
              <div className="flex justify-between">
                <span>Rotate Clockwise</span>
                <span className="font-telemetry font-bold text-white">↑ or X</span>
              </div>
              <div className="flex justify-between">
                <span>Rotate Counter-Clockwise</span>
                <span className="font-telemetry font-bold text-white">Z or Ctrl</span>
              </div>
              <div className="flex justify-between">
                <span>Rotate 180°</span>
                <span className="font-telemetry font-bold text-white">A</span>
              </div>
              <div className="flex justify-between">
                <span>Soft Drop</span>
                <span className="font-telemetry font-bold text-white">↓</span>
              </div>
              <div className="flex justify-between">
                <span>Hard Drop</span>
                <span className="font-telemetry font-bold text-white">Space</span>
              </div>
              <div className="flex justify-between">
                <span>Hold Piece</span>
                <span className="font-telemetry font-bold text-white">C or Shift</span>
              </div>
              <div className="flex justify-between">
                <span>Restart / Pause</span>
                <span className="font-telemetry font-bold text-white">R / Esc</span>
              </div>
            </div>
            <p className={`border-t pt-2 text-xs ${isMono ? 'border-neutral-800 text-neutral-400' : 'border-slate-700 text-slate-400'}`}>
              {isMono
                ? 'Chain Quads for Back-to-Back 1.5x multipliers, Combos, and All Clear bonuses.'
                : 'Chain consecutive Quads or T-Spins for Back-to-Back 1.5x multipliers, Combos, and All Clear bonuses.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

interface EndModalProps {
  edition: Edition;
  noColorResult: NoColorSnapshot | null;
  colorResult: ColorSnapshot | null;
  onPlayAgain: () => void;
  onTitle: () => void;
}

export const EndModal: React.FC<EndModalProps> = ({
  edition,
  noColorResult,
  colorResult,
  onPlayAgain,
  onTitle,
}) => {
  const isMono = edition === 'no-color';
  const isVictory = !isMono && Boolean(colorResult?.victory);

  const cardClass = isMono
    ? 'w-full max-w-sm border-4 border-white bg-black p-6 text-white shadow-2xl'
    : 'w-full max-w-md rounded-2xl border-2 border-slate-300/75 bg-[#1C2029] p-6 text-white shadow-2xl';

  const score = isMono ? noColorResult?.score ?? 0 : colorResult?.score ?? 0;
  const best = isMono ? noColorResult?.bestScore ?? 0 : colorResult?.bestScore ?? 0;
  const lines = isMono ? noColorResult?.lines ?? 0 : colorResult?.lines ?? 0;
  const level = isMono ? noColorResult?.level ?? 1 : colorResult?.level ?? 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isVictory ? 'Stage complete' : 'Game over'}
    >
      <div className={cardClass}>
        <div className="mb-5 text-center">
          <div className={`text-xs font-bold tracking-[0.2em] uppercase ${isMono ? 'text-neutral-400' : 'text-cyan-400'}`}>
            {isMono ? 'NO COLOR EDITION' : `COLOR · ${colorResult?.mode.toUpperCase() ?? 'MARATHON'}`}
          </div>
          <h2 className="mt-1 text-2xl font-extrabold tracking-wider uppercase">
            {isVictory ? 'RUN COMPLETE' : 'GAME OVER'}
          </h2>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2.5">
          <div className={`p-3 text-center ${isMono ? 'border border-neutral-700 bg-black' : 'rounded-lg bg-slate-900'}`}>
            <div className="text-[11px] tracking-widest text-neutral-400">SCORE</div>
            <div className="font-telemetry mt-0.5 text-xl font-extrabold">{score}</div>
          </div>
          <div className={`p-3 text-center ${isMono ? 'border border-neutral-700 bg-black' : 'rounded-lg bg-slate-900'}`}>
            <div className="text-[11px] tracking-widest text-neutral-400">BEST</div>
            <div className="font-telemetry mt-0.5 text-xl font-extrabold">{best}</div>
          </div>
          <div className={`p-3 text-center ${isMono ? 'border border-neutral-700 bg-black' : 'rounded-lg bg-slate-900'}`}>
            <div className="text-[11px] tracking-widest text-neutral-400">LINES</div>
            <div className="font-telemetry mt-0.5 text-lg font-bold">{lines}</div>
          </div>
          <div className={`p-3 text-center ${isMono ? 'border border-neutral-700 bg-black' : 'rounded-lg bg-slate-900'}`}>
            <div className="text-[11px] tracking-widest text-neutral-400">LEVEL</div>
            <div className="font-telemetry mt-0.5 text-lg font-bold">{level}</div>
          </div>
        </div>

        {isMono && noColorResult && (
          <div className="mb-5 flex justify-between border-y border-neutral-800 py-2.5 text-xs text-neutral-300">
            <span>
              Quads: <strong className="font-telemetry text-white">{noColorResult.quads}</strong>
            </span>
            <span>
              B2B: <strong className="font-telemetry text-white">{noColorResult.b2bCount}</strong>
            </span>
            <span>
              All Clear: <strong className="font-telemetry text-white">{noColorResult.allClears}</strong>
            </span>
          </div>
        )}

        {!isMono && colorResult && (
          <div className="mb-5 flex justify-between border-y border-slate-700 py-2.5 text-xs text-slate-300">
            <span>
              T-Spins: <strong className="font-telemetry text-white">{colorResult.tSpins}</strong>
            </span>
            <span>
              Quads: <strong className="font-telemetry text-white">{colorResult.quads}</strong>
            </span>
            <span>
              PPS: <strong className="font-telemetry text-white">{colorResult.pps.toFixed(1)}</strong>
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            data-start="true"
            onClick={onPlayAgain}
            className={`flex-1 py-3 text-sm font-extrabold tracking-widest uppercase ${
              isMono
                ? 'border-2 border-white bg-white text-black hover:bg-neutral-200'
                : 'rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400'
            }`}
          >
            Play Again
          </button>
          <button
            type="button"
            onClick={onTitle}
            className={`flex-1 py-3 text-sm font-bold tracking-widest uppercase ${
              isMono
                ? 'border-2 border-neutral-500 bg-black text-white hover:border-white'
                : 'rounded-lg border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            Title
          </button>
        </div>
      </div>
    </div>
  );
};
