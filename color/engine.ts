// ============================================================================
// COLOR EDITION — Individual Advanced Guideline Block Engine
// ----------------------------------------------------------------------------
// Architecture:
//   * Playfield stored as Uint8Array(240) — 10x24 cells (1 byte per cell = 240B).
//     Rows 0..3 hidden spawn buffer, rows 4..23 visible 20 rows.
//   * Zero-GC pooled particle ring buffer using Float32Array (fixed 64 particles).
//   * Full SRS + Wall Kicks + 180-degree rotation.
//   * T-Spin & T-Spin Mini detection, Back-to-Back (B2B), Combo (Ren), Perfect Clear.
//   * 4 Game Modes: Marathon, Sprint 40L, Ultra 2:00, Zen + Low-Power scheduler.
// ============================================================================

export const C_COLS = 10;
export const C_ROWS = 24;
export const C_VISIBLE_START = 4;

export type ColorMode = 'marathon' | 'sprint' | 'ultra' | 'zen';

export const enum ColorPieceId {
  NONE = 0,
  I = 1,
  O = 2,
  T = 3,
  S = 4,
  Z = 5,
  J = 6,
  L = 7,
}

export interface PieceTheme {
  id: number;
  name: string;
  fill: string;
  light: string;
  dark: string;
  glow: string;
}

export const COLOR_PIECE_THEMES: Record<number, PieceTheme> = {
  [ColorPieceId.I]: {
    id: 1,
    name: 'I',
    fill: '#06B6D4',
    light: '#67E8F9',
    dark: '#0E7490',
    glow: 'rgba(6, 182, 212, 0.38)',
  },
  [ColorPieceId.O]: {
    id: 2,
    name: 'O',
    fill: '#EAB308',
    light: '#FDE047',
    dark: '#A16207',
    glow: 'rgba(234, 179, 8, 0.35)',
  },
  [ColorPieceId.T]: {
    id: 3,
    name: 'T',
    fill: '#A855F7',
    light: '#D8B4FE',
    dark: '#6B21A8',
    glow: 'rgba(168, 85, 247, 0.38)',
  },
  [ColorPieceId.S]: {
    id: 4,
    name: 'S',
    fill: '#22C55E',
    light: '#86EFAC',
    dark: '#15803D',
    glow: 'rgba(34, 197, 94, 0.36)',
  },
  [ColorPieceId.Z]: {
    id: 5,
    name: 'Z',
    fill: '#EF4444',
    light: '#FCA5A5',
    dark: '#B91C1C',
    glow: 'rgba(239, 68, 68, 0.38)',
  },
  [ColorPieceId.J]: {
    id: 6,
    name: 'J',
    fill: '#3B82F6',
    light: '#93C5FD',
    dark: '#1D4ED8',
    glow: 'rgba(59, 130, 246, 0.38)',
  },
  [ColorPieceId.L]: {
    id: 7,
    name: 'L',
    fill: '#F97316',
    light: '#FDBA74',
    dark: '#C2410C',
    glow: 'rgba(249, 115, 22, 0.38)',
  },
};

const pack4x4 = (rows: readonly [string, string, string, string]): number => {
  let mask = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (rows[r][c] === '#') {
        mask |= 1 << (r * 4 + c);
      }
    }
  }
  return mask;
};

// Index: ((pieceId - 1) << 2) | rot
export const C_PIECE_MASKS = new Uint16Array([
  // I (1)
  pack4x4(['....', '####', '....', '....']),
  pack4x4(['..#.', '..#.', '..#.', '..#.']),
  pack4x4(['....', '....', '####', '....']),
  pack4x4(['.#..', '.#..', '.#..', '.#..']),
  // O (2)
  pack4x4(['.##.', '.##.', '....', '....']),
  pack4x4(['.##.', '.##.', '....', '....']),
  pack4x4(['.##.', '.##.', '....', '....']),
  pack4x4(['.##.', '.##.', '....', '....']),
  // T (3)
  pack4x4(['.#..', '###.', '....', '....']),
  pack4x4(['.#..', '.##.', '.#..', '....']),
  pack4x4(['....', '###.', '.#..', '....']),
  pack4x4(['.#..', '##..', '.#..', '....']),
  // S (4)
  pack4x4(['.##.', '##..', '....', '....']),
  pack4x4(['.#..', '.##.', '..#.', '....']),
  pack4x4(['....', '.##.', '##..', '....']),
  pack4x4(['#...', '##..', '.#..', '....']),
  // Z (5)
  pack4x4(['##..', '.##.', '....', '....']),
  pack4x4(['..#.', '.##.', '.#..', '....']),
  pack4x4(['....', '##..', '.##.', '....']),
  pack4x4(['.#..', '##..', '#...', '....']),
  // J (6)
  pack4x4(['#...', '###.', '....', '....']),
  pack4x4(['.##.', '.#..', '.#..', '....']),
  pack4x4(['....', '###.', '..#.', '....']),
  pack4x4(['.#..', '.#..', '##..', '....']),
  // L (7)
  pack4x4(['..#.', '###.', '....', '....']),
  pack4x4(['.#..', '.#..', '.##.', '....']),
  pack4x4(['....', '###.', '#...', '....']),
  pack4x4(['##..', '.#..', '.#..', '....']),
]);

const JLSTZ_KICKS = new Int8Array([
  // 0->1
  0, 0, -1, 0, -1, -1, 0, 2, -1, 2,
  // 1->0
  0, 0, 1, 0, 1, 1, 0, -2, 1, -2,
  // 1->2
  0, 0, 1, 0, 1, 1, 0, -2, 1, -2,
  // 2->1
  0, 0, -1, 0, -1, -1, 0, 2, -1, 2,
  // 2->3
  0, 0, 1, 0, 1, -1, 0, 2, 1, 2,
  // 3->2
  0, 0, -1, 0, -1, 1, 0, -2, -1, -2,
  // 3->0
  0, 0, -1, 0, -1, 1, 0, -2, -1, -2,
  // 0->3
  0, 0, 1, 0, 1, -1, 0, 2, 1, 2,
]);

const I_KICKS = new Int8Array([
  // 0->1
  0, 0, -2, 0, 1, 0, -2, 1, 1, -2,
  // 1->0
  0, 0, 2, 0, -1, 0, 2, -1, -1, 2,
  // 1->2
  0, 0, -1, 0, 2, 0, -1, -2, 2, 1,
  // 2->1
  0, 0, 1, 0, -2, 0, 1, 2, -2, -1,
  // 2->3
  0, 0, 2, 0, -1, 0, 2, -1, -1, 2,
  // 3->2
  0, 0, -2, 0, 1, 0, -2, 1, 1, -2,
  // 3->0
  0, 0, 1, 0, -2, 0, 1, 2, -2, -1,
  // 0->3
  0, 0, -1, 0, 2, 0, -1, -2, 2, 1,
]);

// 180-degree SRS+ kick tables (5 tests per orientation)
const KICKS_180 = new Int8Array([
  // 0->2
  0, 0, 0, -1, 1, -1, -1, -1, 0, 1,
  // 1->3
  0, 0, 1, 0, 1, -2, 1, -1, -1, 0,
  // 2->0
  0, 0, 0, 1, -1, 1, 1, 1, 0, -1,
  // 3->1
  0, 0, -1, 0, -1, 2, -1, 1, 1, 0,
]);

const getKickOffsetIndex = (fromRot: number, toRot: number): number => {
  if (fromRot === 0 && toRot === 1) return 0;
  if (fromRot === 1 && toRot === 0) return 10;
  if (fromRot === 1 && toRot === 2) return 20;
  if (fromRot === 2 && toRot === 1) return 30;
  if (fromRot === 2 && toRot === 3) return 40;
  if (fromRot === 3 && toRot === 2) return 50;
  if (fromRot === 3 && toRot === 0) return 60;
  if (fromRot === 0 && toRot === 3) return 70;
  return 0;
};

export type TSpinKind = 'none' | 'mini' | 'full';

export type ColorStepEvent =
  | 'none'
  | 'move'
  | 'rotate'
  | 'softDrop'
  | 'hardDrop'
  | 'hold'
  | 'lock'
  | 'line1'
  | 'line2'
  | 'line3'
  | 'quad'
  | 'tspin'
  | 'levelUp'
  | 'victory'
  | 'gameOver';

export interface ColorSnapshot {
  mode: ColorMode;
  score: number;
  bestScore: number;
  level: number;
  lines: number;
  targetLines: number;
  combo: number;
  b2b: boolean;
  b2bCount: number;
  tSpins: number;
  quads: number;
  allClears: number;
  piecesPlaced: number;
  elapsedSec: number;
  remainingSec: number;
  pps: number;
  holdId: number;
  canHold: boolean;
  nextIds: [number, number, number, number, number];
  lastCallout: string;
  calloutId: number;
  gameOver: boolean;
  victory: boolean;
  memoryBytes: number;
}

// Pre-allocated zero-GC particle ring buffer (64 particles * 7 floats = 1792B)
export const PARTICLE_POOL_CAP = 64;
export const PARTICLE_STRIDE = 7; // x, y, vx, vy, life, maxLife, colorId

export class ColorEngine {
  // 240 bytes for 10x24 matrix
  public readonly board = new Uint8Array(C_COLS * C_ROWS);

  // Two pre-allocated 7-bag buffers (14 bytes)
  private readonly bagA = new Uint8Array(7);
  private readonly bagB = new Uint8Array(7);
  private bagIndex = 0;

  // Zero-GC particle pool (Float32Array)
  public readonly particles = new Float32Array(PARTICLE_POOL_CAP * PARTICLE_STRIDE);
  private particleCursor = 0;

  // Visual juice state (mutated in-place)
  public hitstopTimer = 0;
  public shakeTrauma = 0;
  public lineClearFlashTimer = 0;
  public readonly clearingRows = new Uint8Array(C_ROWS);

  // Mode & rules
  public mode: ColorMode = 'marathon';
  public activeId: number = ColorPieceId.NONE;
  public activeX = 3;
  public activeY = 0;
  public activeRot = 0;
  public ghostY = 0;

  public holdId: number = ColorPieceId.NONE;
  public canHold = true;

  // Telemetry & scoring
  public score = 0;
  public bestScore = 0;
  public startLevel = 1;
  public level = 1;
  public lines = 0;
  public targetLines = 0; // 40 in sprint, 150 in marathon, 0 endless
  public combo = -1;
  public b2b = false;
  public b2bCount = 0;
  public tSpins = 0;
  public quads = 0;
  public allClears = 0;
  public piecesPlaced = 0;
  public elapsedSec = 0;
  public remainingSec = 0; // 120 in ultra

  public lastCallout = '';
  public calloutId = 0;
  public calloutTimer = 0;

  public boardRevision = 1;
  public activeParticlesCount = 0;

  public gameOver = false;
  public victory = false;

  // Rotation / T-spin state
  private lastActionWasRotation = false;
  private lastRotationKickIndex = 0;

  // Gravity & lock delay
  private gravityTimer = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private isGrounded = false;

  private rngState: number;

  constructor(mode: ColorMode = 'marathon', seed = 0x9e3779b9, bestScore = 0, startLevel = 1) {
    this.rngState = seed >>> 0 || 1;
    this.bestScore = bestScore;
    this.reset(mode, seed, startLevel);
  }

  private nextRand(max: number): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState % max;
  }

  private fillBag(target: Uint8Array): void {
    for (let i = 0; i < 7; i++) target[i] = i + 1; // 1..7
    for (let i = 6; i > 0; i--) {
      const j = this.nextRand(i + 1);
      const tmp = target[i];
      target[i] = target[j];
      target[j] = tmp;
    }
  }

  public reset(mode: ColorMode = this.mode, seed?: number, startLevel = this.startLevel): void {
    this.mode = mode;
    if (seed !== undefined) {
      this.rngState = seed >>> 0 || 1;
    }
    this.startLevel = Math.max(1, Math.min(15, Math.floor(startLevel)));
    this.board.fill(0);
    this.particles.fill(0);
    this.clearingRows.fill(0);
    this.particleCursor = 0;
    this.activeParticlesCount = 0;

    this.fillBag(this.bagA);
    this.fillBag(this.bagB);
    this.bagIndex = 0;

    this.holdId = ColorPieceId.NONE;
    this.canHold = true;
    this.score = 0;
    this.level = mode === 'zen' ? 1 : this.startLevel;
    this.lines = 0;
    this.targetLines = mode === 'sprint' ? 40 : mode === 'marathon' ? 150 : 0;
    this.combo = -1;
    this.b2b = false;
    this.b2bCount = 0;
    this.tSpins = 0;
    this.quads = 0;
    this.allClears = 0;
    this.piecesPlaced = 0;
    this.elapsedSec = 0;
    this.remainingSec = mode === 'ultra' ? 120 : 0;

    this.lastCallout = '';
    this.calloutId = 0;
    this.calloutTimer = 0;

    this.gameOver = false;
    this.victory = false;
    this.hitstopTimer = 0;
    this.shakeTrauma = 0;
    this.lineClearFlashTimer = 0;

    this.lastActionWasRotation = false;
    this.lastRotationKickIndex = 0;
    this.gravityTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.isGrounded = false;
    this.boardRevision++;

    this.spawnNext();
  }

  private popBag(): number {
    const id = this.bagA[this.bagIndex];
    this.bagIndex++;
    if (this.bagIndex >= 7) {
      this.bagA.set(this.bagB);
      this.fillBag(this.bagB);
      this.bagIndex = 0;
    }
    return id;
  }

  public getNextIds(out: [number, number, number, number, number]): void {
    for (let i = 0; i < 5; i++) {
      const idx = this.bagIndex + i;
      out[i] = idx < 7 ? this.bagA[idx] : this.bagB[idx - 7];
    }
  }

  public getMask(id: number, rot: number): number {
    return C_PIECE_MASKS[((id - 1) << 2) | (rot & 3)];
  }

  public isCellOccupied(bx: number, by: number): boolean {
    if (bx < 0 || bx >= C_COLS || by >= C_ROWS) return true;
    if (by < 0) return false;
    return this.board[by * C_COLS + bx] !== 0;
  }

  public collides(id: number, rot: number, px: number, py: number): boolean {
    const mask = this.getMask(id, rot);
    for (let r = 0; r < 4; r++) {
      const rowNibble = (mask >>> (r << 2)) & 0xf;
      if (rowNibble === 0) continue;
      const by = py + r;
      for (let c = 0; c < 4; c++) {
        if ((rowNibble & (1 << c)) === 0) continue;
        const bx = px + c;
        if (bx < 0 || bx >= C_COLS || by >= C_ROWS) return true;
        if (by >= 0 && this.board[by * C_COLS + bx] !== 0) return true;
      }
    }
    return false;
  }

  private updateGhost(): void {
    let gy = this.activeY;
    while (!this.collides(this.activeId, this.activeRot, this.activeX, gy + 1)) {
      gy++;
    }
    this.ghostY = gy;
  }

  private spawnNext(): boolean {
    return this.spawnPiece(this.popBag());
  }

  private spawnPiece(id: number): boolean {
    this.activeId = id;
    this.activeRot = 0;
    this.activeX = 3;
    this.activeY = 2; // spawn inside top visible boundary buffer (rows 2..3)
    this.gravityTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lastActionWasRotation = false;
    this.lastRotationKickIndex = 0;

    if (this.collides(this.activeId, this.activeRot, this.activeX, this.activeY)) {
      this.gameOver = true;
      this.boardRevision++;
      return false;
    }

    if (!this.collides(this.activeId, this.activeRot, this.activeX, this.activeY + 1)) {
      this.activeY++;
    }
    this.isGrounded = this.collides(this.activeId, this.activeRot, this.activeX, this.activeY + 1);
    this.updateGhost();
    this.boardRevision++;
    return true;
  }

  public move(dx: number): boolean {
    if (this.gameOver || this.victory) return false;
    const nx = this.activeX + dx;
    if (this.collides(this.activeId, this.activeRot, nx, this.activeY)) {
      return false;
    }
    this.activeX = nx;
    this.lastActionWasRotation = false;
    this.onTransformSuccess();
    return true;
  }

  public rotate(dir: 1 | -1 | 2): boolean {
    if (this.gameOver || this.victory) return false;
    if (this.activeId === ColorPieceId.O) {
      this.lastActionWasRotation = false;
      return false;
    }

    const fromRot = this.activeRot;
    const toRot = (fromRot + dir + 4) & 3;

    if (dir === 2) {
      const baseIdx = fromRot * 10;
      for (let t = 0; t < 5; t++) {
        const kx = KICKS_180[baseIdx + t * 2];
        const ky = KICKS_180[baseIdx + t * 2 + 1];
        const nx = this.activeX + kx;
        const ny = this.activeY + ky;
        if (!this.collides(this.activeId, toRot, nx, ny)) {
          this.activeRot = toRot;
          this.activeX = nx;
          this.activeY = ny;
          this.lastActionWasRotation = true;
          this.lastRotationKickIndex = t;
          this.onTransformSuccess();
          return true;
        }
      }
      return false;
    }

    const table = this.activeId === ColorPieceId.I ? I_KICKS : JLSTZ_KICKS;
    const baseIdx = getKickOffsetIndex(fromRot, toRot);

    for (let t = 0; t < 5; t++) {
      const kx = table[baseIdx + t * 2];
      const ky = table[baseIdx + t * 2 + 1];
      const nx = this.activeX + kx;
      const ny = this.activeY + ky;
      if (!this.collides(this.activeId, toRot, nx, ny)) {
        this.activeRot = toRot;
        this.activeX = nx;
        this.activeY = ny;
        this.lastActionWasRotation = true;
        this.lastRotationKickIndex = t;
        this.onTransformSuccess();
        return true;
      }
    }
    return false;
  }

  private onTransformSuccess(): void {
    this.isGrounded = this.collides(this.activeId, this.activeRot, this.activeX, this.activeY + 1);
    if (this.isGrounded && this.lockResets < 15) {
      this.lockTimer = 0;
      this.lockResets++;
    }
    this.updateGhost();
    this.boardRevision++;
  }

  public softDropStep(): boolean {
    if (this.gameOver || this.victory) return false;
    if (!this.collides(this.activeId, this.activeRot, this.activeX, this.activeY + 1)) {
      this.activeY++;
      this.score += 1;
      if (this.score > this.bestScore) this.bestScore = this.score;
      this.gravityTimer = 0;
      this.lastActionWasRotation = false;
      this.isGrounded = this.collides(this.activeId, this.activeRot, this.activeX, this.activeY + 1);
      this.boardRevision++;
      return true;
    }
    return false;
  }

  public hardDrop(): ColorStepEvent {
    if (this.gameOver || this.victory) return 'none';
    const dist = this.ghostY - this.activeY;
    if (dist > 0) {
      this.activeY = this.ghostY;
      this.score += dist * 2;
      if (this.score > this.bestScore) this.bestScore = this.score;
      this.lastActionWasRotation = false;
    }
    this.shakeTrauma = Math.min(1, this.shakeTrauma + 0.18);
    this.spawnDropImpactParticles();
    const ev = this.lockActivePiece();
    return ev === 'lock' ? 'hardDrop' : ev;
  }

  public hold(): boolean {
    if (this.gameOver || this.victory || !this.canHold) return false;
    const current = this.activeId;
    if (this.holdId === ColorPieceId.NONE) {
      this.holdId = current;
      this.spawnNext();
    } else {
      const swapped = this.holdId;
      this.holdId = current;
      this.spawnPiece(swapped);
    }
    this.canHold = false;
    this.boardRevision++;
    return true;
  }

  public detectTSpin(): TSpinKind {
    if (this.activeId !== ColorPieceId.T || !this.lastActionWasRotation) {
      return 'none';
    }
    // 3-corner T-slot rule around T center (activeX + 1, activeY + 1)
    const cx = this.activeX + 1;
    const cy = this.activeY + 1;
    const tl = this.isCellOccupied(cx - 1, cy - 1) ? 1 : 0;
    const tr = this.isCellOccupied(cx + 1, cy - 1) ? 1 : 0;
    const bl = this.isCellOccupied(cx - 1, cy + 1) ? 1 : 0;
    const br = this.isCellOccupied(cx + 1, cy + 1) ? 1 : 0;

    const totalCorners = tl + tr + bl + br;
    if (totalCorners < 3) return 'none';

    // Front two corners depend on orientation
    let frontCorners = 0;
    if (this.activeRot === 0) frontCorners = tl + tr;
    else if (this.activeRot === 1) frontCorners = tr + br;
    else if (this.activeRot === 2) frontCorners = bl + br;
    else frontCorners = tl + bl;

    // Full T-Spin if both front corners occupied OR 5th SRS kick test (index 4) was used
    if (frontCorners === 2 || this.lastRotationKickIndex === 4) {
      return 'full';
    }
    return 'mini';
  }

  public getFallInterval(): number {
    if (this.mode === 'zen') return 0.9;
    const exp = Math.min(19, this.level - 1);
    const speed = Math.pow(0.8 - exp * 0.007, exp);
    return Math.max(0.015, speed);
  }

  private emitParticle(x: number, y: number, vx: number, vy: number, life: number, colorId: number): void {
    const idx = this.particleCursor * PARTICLE_STRIDE;
    this.particles[idx] = x;
    this.particles[idx + 1] = y;
    this.particles[idx + 2] = vx;
    this.particles[idx + 3] = vy;
    this.particles[idx + 4] = life;
    this.particles[idx + 5] = life;
    this.particles[idx + 6] = colorId;
    this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_CAP;
  }

  private spawnDropImpactParticles(): void {
    const mask = this.getMask(this.activeId, this.activeRot);
    for (let r = 0; r < 4; r++) {
      const rowNibble = (mask >>> (r << 2)) & 0xf;
      if (rowNibble === 0) continue;
      for (let c = 0; c < 4; c++) {
        if ((rowNibble & (1 << c)) === 0) continue;
        const wx = this.activeX + c + 0.5;
        const wy = this.activeY + r - C_VISIBLE_START + 0.9;
        if (wy < 0) continue;
        for (let k = 0; k < 2; k++) {
          const vx = (this.nextRand(200) - 100) / 40;
          const vy = -(this.nextRand(100) + 40) / 45;
          this.emitParticle(wx, wy, vx, vy, 0.28, this.activeId);
        }
      }
    }
  }

  private spawnLineClearParticles(rowY: number): void {
    const vy = rowY - C_VISIBLE_START + 0.5;
    if (vy < 0) return;
    for (let x = 0; x < C_COLS; x++) {
      const cellColor = this.board[rowY * C_COLS + x] || this.activeId;
      for (let k = 0; k < 2; k++) {
        const pvx = (this.nextRand(240) - 120) / 25;
        const pvy = (this.nextRand(200) - 140) / 28;
        this.emitParticle(x + 0.5, vy, pvx, pvy, 0.45, cellColor);
      }
    }
  }

  public hasActiveVisualEffects(): boolean {
    return (
      this.activeParticlesCount > 0 ||
      this.shakeTrauma > 0.005 ||
      this.lineClearFlashTimer > 0 ||
      this.hitstopTimer > 0
    );
  }

  public getNextWakeDelayMs(): number {
    if (this.gameOver || this.victory) return 1000;
    if (this.hasActiveVisualEffects()) return 16;
    let nextSec = 0.25;
    if (this.isGrounded) {
      nextSec = Math.min(nextSec, Math.max(0.016, 0.5 - this.lockTimer));
    } else {
      nextSec = Math.min(nextSec, Math.max(0.016, this.getFallInterval() - this.gravityTimer));
    }
    if (this.mode === 'ultra' || this.mode === 'sprint') {
      nextSec = Math.min(nextSec, 0.2); // smooth 5Hz timer clock update
    }
    return Math.max(16, Math.ceil(nextSec * 1000));
  }

  public tick(dt: number): ColorStepEvent {
    if (this.gameOver || this.victory) return 'none';

    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 2.8);
    if (this.lineClearFlashTimer > 0) {
      this.lineClearFlashTimer = Math.max(0, this.lineClearFlashTimer - dt);
      if (this.lineClearFlashTimer === 0) this.boardRevision++;
    }
    if (this.calloutTimer > 0) {
      this.calloutTimer = Math.max(0, this.calloutTimer - dt);
    }
    let alive = 0;
    for (let i = 0; i < PARTICLE_POOL_CAP; i++) {
      const idx = i * PARTICLE_STRIDE;
      if (this.particles[idx + 4] > 0) {
        this.particles[idx] += this.particles[idx + 2] * dt;
        this.particles[idx + 1] += this.particles[idx + 3] * dt;
        this.particles[idx + 3] += 14 * dt; // gravity
        this.particles[idx + 4] -= dt;
        if (this.particles[idx + 4] > 0) alive++;
      }
    }
    this.activeParticlesCount = alive;

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      return 'none';
    }

    this.elapsedSec += dt;
    if (this.mode === 'ultra') {
      this.remainingSec = Math.max(0, 120 - this.elapsedSec);
      if (this.remainingSec <= 0) {
        this.victory = true;
        this.boardRevision++;
        this.triggerCallout('TIME UP!');
        return 'victory';
      }
    }

    const interval = this.getFallInterval();
    this.gravityTimer += dt;

    let movedDown = false;
    while (this.gravityTimer >= interval) {
      this.gravityTimer -= interval;
      if (!this.collides(this.activeId, this.activeRot, this.activeX, this.activeY + 1)) {
        this.activeY++;
        movedDown = true;
        this.lastActionWasRotation = false;
        this.isGrounded = this.collides(this.activeId, this.activeRot, this.activeX, this.activeY + 1);
      } else {
        this.isGrounded = true;
        break;
      }
    }
    if (movedDown) {
      this.boardRevision++;
    }

    if (this.isGrounded) {
      this.lockTimer += dt;
      if (this.lockTimer >= 0.5) {
        return this.lockActivePiece();
      }
    } else {
      this.lockTimer = 0;
    }

    return 'none';
  }

  private triggerCallout(text: string): void {
    this.lastCallout = text;
    this.calloutId++;
    this.calloutTimer = 1.35;
  }

  private isBoardEmpty(): boolean {
    for (let i = 0; i < this.board.length; i++) {
      if (this.board[i] !== 0) return false;
    }
    return true;
  }

  private lockActivePiece(): ColorStepEvent {
    const tSpin = this.detectTSpin();
    const mask = this.getMask(this.activeId, this.activeRot);
    let anyVisible = false;

    for (let r = 0; r < 4; r++) {
      const rowNibble = (mask >>> (r << 2)) & 0xf;
      if (rowNibble === 0) continue;
      const by = this.activeY + r;
      if (by < 0 || by >= C_ROWS) continue;
      if (by >= C_VISIBLE_START) anyVisible = true;
      for (let c = 0; c < 4; c++) {
        if ((rowNibble & (1 << c)) !== 0) {
          this.board[by * C_COLS + (this.activeX + c)] = this.activeId;
        }
      }
    }

    if (!anyVisible) {
      this.gameOver = true;
      return 'gameOver';
    }

    this.piecesPlaced++;

    // Scan full lines
    this.clearingRows.fill(0);
    let cleared = 0;
    for (let y = C_ROWS - 1; y >= 0; y--) {
      let full = true;
      const rowOffset = y * C_COLS;
      for (let x = 0; x < C_COLS; x++) {
        if (this.board[rowOffset + x] === 0) {
          full = false;
          break;
        }
      }
      if (full) {
        this.clearingRows[y] = 1;
        cleared++;
        this.spawnLineClearParticles(y);
      }
    }

    // Collapse cleared lines
    if (cleared > 0) {
      this.lineClearFlashTimer = 0.14;
      let writeY = C_ROWS - 1;
      for (let readY = C_ROWS - 1; readY >= 0; readY--) {
        if (this.clearingRows[readY] === 1) continue;
        if (writeY !== readY) {
          const dst = writeY * C_COLS;
          const src = readY * C_COLS;
          for (let x = 0; x < C_COLS; x++) {
            this.board[dst + x] = this.board[src + x];
          }
        }
        writeY--;
      }
      while (writeY >= 0) {
        const dst = writeY * C_COLS;
        for (let x = 0; x < C_COLS; x++) {
          this.board[dst + x] = 0;
        }
        writeY--;
      }
    }

    // Guideline Scoring + T-Spin + B2B + Combo + Perfect Clear
    let baseScore = 0;
    let isDifficult = false;
    const calloutParts: string[] = [];

    if (tSpin === 'full') {
      this.tSpins++;
      if (cleared === 0) baseScore = 400;
      else if (cleared === 1) {
        baseScore = 800;
        isDifficult = true;
        calloutParts.push('T-SPIN SINGLE');
      } else if (cleared === 2) {
        baseScore = 1200;
        isDifficult = true;
        calloutParts.push('T-SPIN DOUBLE');
      } else if (cleared === 3) {
        baseScore = 1600;
        isDifficult = true;
        calloutParts.push('T-SPIN TRIPLE');
      }
      if (cleared === 0) calloutParts.push('T-SPIN');
    } else if (tSpin === 'mini') {
      this.tSpins++;
      if (cleared === 0) baseScore = 100;
      else if (cleared === 1) {
        baseScore = 200;
        isDifficult = true;
        calloutParts.push('MINI T-SPIN SINGLE');
      } else if (cleared === 2) {
        baseScore = 400;
        isDifficult = true;
        calloutParts.push('MINI T-SPIN DOUBLE');
      }
      if (cleared === 0) calloutParts.push('MINI T-SPIN');
    } else if (cleared > 0) {
      if (cleared === 1) baseScore = 100;
      else if (cleared === 2) baseScore = 300;
      else if (cleared === 3) baseScore = 500;
      else if (cleared === 4) {
        baseScore = 800;
        isDifficult = true;
        this.quads++;
        calloutParts.push('QUAD!');
      }
    }

    let levelChanged = false;
    if (cleared > 0) {
      this.combo++;
      if (isDifficult) {
        if (this.b2b) {
          baseScore = Math.floor(baseScore * 1.5);
          this.b2bCount++;
          calloutParts.unshift('BACK-TO-BACK');
        }
        this.b2b = true;
      } else {
        this.b2b = false;
      }

      const comboBonus = this.combo > 0 ? 50 * this.combo * this.level : 0;
      if (this.combo > 0) {
        calloutParts.push(`${this.combo} COMBO`);
      }

      let allClearBonus = 0;
      if (this.isBoardEmpty()) {
        this.allClears++;
        allClearBonus = cleared === 4 ? 3200 : 1800;
        calloutParts.push('ALL CLEAR!');
      }

      this.score += (baseScore + allClearBonus) * this.level + comboBonus;
      if (this.score > this.bestScore) this.bestScore = this.score;

      this.lines += cleared;
      if (this.mode === 'marathon' || this.mode === 'ultra') {
        const prevLevel = this.level;
        this.level = Math.max(this.startLevel, Math.floor(this.lines / 10) + this.startLevel);
        levelChanged = this.level > prevLevel;
      }

      if (isDifficult || allClearBonus > 0 || cleared >= 4) {
        this.hitstopTimer = 0.045;
        this.shakeTrauma = Math.min(1, this.shakeTrauma + 0.45);
      } else {
        this.shakeTrauma = Math.min(1, this.shakeTrauma + 0.16);
      }
    } else {
      this.combo = -1;
      if (baseScore > 0) {
        this.score += baseScore * this.level;
        if (this.score > this.bestScore) this.bestScore = this.score;
      }
    }

    if (calloutParts.length > 0) {
      this.triggerCallout(calloutParts.join(' · '));
    }

    // Check Victory conditions for Sprint 40L & Marathon 150L
    if (this.mode === 'sprint' && this.lines >= 40) {
      this.victory = true;
      this.boardRevision++;
      this.triggerCallout('40 LINES COMPLETE!');
      return 'victory';
    }
    if (this.mode === 'marathon' && this.lines >= 150) {
      this.victory = true;
      this.boardRevision++;
      this.triggerCallout('MARATHON CLEAR!');
      return 'victory';
    }

    this.canHold = true;
    const spawned = this.spawnNext();
    this.boardRevision++;
    if (!spawned) {
      return 'gameOver';
    }

    if (tSpin !== 'none' && cleared > 0) return 'tspin';
    if (cleared === 4) return 'quad';
    if (cleared === 3) return 'line3';
    if (cleared === 2) return 'line2';
    if (cleared === 1) return 'line1';
    if (levelChanged) return 'levelUp';
    return 'lock';
  }

  public getLockProgress(): number {
    return this.isGrounded ? Math.min(1, this.lockTimer / 0.5) : 0;
  }

  public getMemoryFootprintBytes(): number {
    return (
      this.board.byteLength +
      this.bagA.byteLength +
      this.bagB.byteLength +
      this.particles.byteLength +
      this.clearingRows.byteLength +
      C_PIECE_MASKS.byteLength +
      JLSTZ_KICKS.byteLength +
      I_KICKS.byteLength +
      KICKS_180.byteLength
    );
  }

  public getSnapshot(): ColorSnapshot {
    const nextIds: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    this.getNextIds(nextIds);
    const pps = this.elapsedSec > 0.25 ? this.piecesPlaced / this.elapsedSec : 0;
    return {
      mode: this.mode,
      score: this.score,
      bestScore: this.bestScore,
      level: this.level,
      lines: this.lines,
      targetLines: this.targetLines,
      combo: Math.max(0, this.combo),
      b2b: this.b2b,
      b2bCount: this.b2bCount,
      tSpins: this.tSpins,
      quads: this.quads,
      allClears: this.allClears,
      piecesPlaced: this.piecesPlaced,
      elapsedSec: this.elapsedSec,
      remainingSec: this.remainingSec,
      pps,
      holdId: this.holdId,
      canHold: this.canHold,
      nextIds,
      lastCallout: this.calloutTimer > 0 ? this.lastCallout : '',
      calloutId: this.calloutId,
      gameOver: this.gameOver,
      victory: this.victory,
      memoryBytes: this.getMemoryFootprintBytes(),
    };
  }
}
