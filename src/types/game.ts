export type Edition = 'no-color' | 'color';

export type ScreenState = 'title' | 'playing' | 'paused' | 'gameover';

export type ColorMode = 'marathon' | 'sprint' | 'ultra' | 'zen';

export interface GameOptions {
  ghostPiece: boolean;
  gridLines: boolean;
  soundEnabled: boolean;
  lowPowerMode: boolean;
  startLevel: number;
  dasMs: number; // Delayed Auto Shift (ms)
  arrMs: number; // Auto Repeat Rate (ms)
  sdf: number; // Soft Drop Factor (1..40, 40 = instant)
  allow180: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = {
  ghostPiece: true,
  gridLines: true,
  soundEnabled: true,
  lowPowerMode: true,
  startLevel: 1,
  dasMs: 135,
  arrMs: 25,
  sdf: 16,
  allow180: true,
};
