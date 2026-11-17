// ============================================================================
// NO COLOR EDITION — Individual Ultra-Low-Memory & Low-Power Bitboard Engine
// ----------------------------------------------------------------------------
// Architecture:
//   * Playfield stored as Uint16Array(22) — 44 bytes total for 10x22 cells.
//     Each row is a 10-bit mask (bit 0 = col 0 .. bit 9 = col 9; full row = 0x3FF).
//   * Pieces stored as 16-bit 4x4 bitmasks in Uint16Array(28).
//   * Zero per-frame heap allocations during gameplay.
//   * Pure black-and-white monochrome gameplay (no color channels).
//   * Supports event-driven Low-Power wake scheduling via getNextWakeDelayMs().
// ============================================================================

export const NC_COLS = 10;
export const NC_ROWS = 22; // rows 0..1 hidden buffer, rows 2..21 visible (20 rows)
export const NC_VISIBLE_START = 2;
export const NC_FULL_ROW = 0x3ff; // 0b1111111111

export const enum NoColorPieceId {
  I = 0,
  O = 1,
  T = 2,
  S = 3,
  Z = 4,
  J = 5,
  L = 6,
  NONE = 255,
}

export const NO_COLOR_PIECE_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;

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

// 7 pieces * 4 rotations = 28 uint16 masks (56 bytes)
export const NC_PIECE_MASKS = new Uint16Array([
  // I (0)
  pack4x4(['....', '####', '....', '....']),
  pack4x4(['..#.', '..#.', '..#.', '..#.']),
  pack4x4(['....', '....', '####', '....']),
  pack4x4(['.#..', '.#..', '.#..', '.#..']),
  // O (1)
  pack4x4(['.##.', '.##.', '....', '....']),
  pack4x4(['.##.', '.##.', '....', '....']),
  pack4x4(['.##.', '.##.', '....', '....']),
  pack4x4(['.##.', '.##.', '....', '....']),
  // T (2)
  pack4x4(['.#..', '###.', '....', '....']),
  pack4x4(['.#..', '.##.', '.#..', '....']),
  pack4x4(['....', '###.', '.#..', '....']),
  pack4x4(['.#..', '##..', '.#..', '....']),
  // S (3)
  pack4x4(['.##.', '##..', '....', '....']),
  pack4x4(['.#..', '.##.', '..#.', '....']),
  pack4x4(['....', '.##.', '##..', '....']),
  pack4x4(['#...', '##..', '.#..', '....']),
  // Z (4)
  pack4x4(['##..', '.##.', '....', '....']),
  pack4x4(['..#.', '.##.', '.#..', '....']),
  pack4x4(['....', '##..', '.##.', '....']),
  pack4x4(['.#..', '##..', '#...', '....']),
  // J (5)
  pack4x4(['#...', '###.', '....', '....']),
  pack4x4(['.##.', '.#..', '.#..', '....']),
  pack4x4(['....', '###.', '..#.', '....']),
  pack4x4(['.#..', '.#..', '##..', '....']),
  // L (6)
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

export type NoColorStepEvent =
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
  | 'blast'
  | 'levelUp'
  | 'gameOver';

export interface NoColorSnapshot {
  score: number;
  level: number;
  lines: number;
  bestScore: number;
  combo: number;
  b2b: boolean;
  b2bCount: number;
  quads: number;
  allClears: number;
  superBlasts: number;
  isSuperActive: boolean;
  isNextSuper: boolean;
  piecesPlaced: number;
  lastCallout: string;
  gameOver: boolean;
  holdId: number;
  holdIsSuper: boolean;
  canHold: boolean;
  nextIds: [number, number, number];
  memoryBytes: number;
}

export class NoColorEngine {
  // 44 bytes: 22 rows of 10-bit occupancy bitmasks
  public readonly board = new Uint16Array(NC_ROWS);

  // Two pre-allocated 7-bag buffers (14 bytes total)
  private readonly bagA = new Uint8Array(7);
  private readonly bagB = new Uint8Array(7);
  private bagIndex = 0;

  // Active piece primitive state (zero object allocations)
  public activeId: number = NoColorPieceId.NONE;
  public activeX = 3;
  public activeY = 0;
  public activeRot = 0;
  public ghostY = 0;

  public holdId: number = NoColorPieceId.NONE;
  public canHold = true;

  public score = 0;
  public startLevel = 1;
  public level = 1;
  public lines = 0;
  public bestScore = 0;
  public combo = -1;
  public b2b = false;
  public b2bCount = 0;
  public quads = 0;
  public allClears = 0;
  public piecesPlaced = 0;
  public gameOver = false;

  public lastCallout = '';
  public calloutTimer = 0;

  // Monotonically incrementing revision counter so Low-Power renderer skips idle repaints
  public boardRevision = 1;

  // Timing accumulators (seconds)
  private gravityTimer = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private isGrounded = false;

  // Super Block reward & blast state (scalar primitives, 0 extra TypedArray heap)
  public isNextSuper = false;
  public isSuperActive = false;
  public holdIsSuper = false;
  public superBlasts = 0;
  private nextSuperAtLines = 8;

  // Line flash & impact FX state (consumed by monochrome spark/beam renderer)
  public clearFlashTimer = 0;
  public clearFlashRowsMask = 0; // 22-bit mask of rows flashing
  public blastFlashTimer = 0;
  public lastImpactX = 4.5;
  public lastImpactY = 18;
  public lastImpactKind: 0 | 1 | 2 = 0; // 0 = drop, 1 = lineClear, 2 = superBlast
  public impactNonce = 0;

  private rngState: number;

  constructor(seed = 0x5f3759df, bestScore = 0, startLevel = 1) {
    this.rngState = seed >>> 0 || 1;
    this.bestScore = bestScore;
    this.reset(seed, startLevel);
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
    for (let i = 0; i < 7; i++) target[i] = i;
    for (let i = 6; i > 0; i--) {
      const j = this.nextRand(i + 1);
      const tmp = target[i];
      target[i] = target[j];
      target[j] = tmp;
    }
  }

  public reset(seed?: number, startLevel = this.startLevel): void {
    if (seed !== undefined) {
      this.rngState = seed >>> 0 || 1;
    }
    this.startLevel = Math.max(1, Math.min(15, Math.floor(startLevel)));
    this.board.fill(0);
    this.fillBag(this.bagA);
    this.fillBag(this.bagB);
    this.bagIndex = 0;

    this.holdId = NoColorPieceId.NONE;
    this.canHold = true;
    this.score = 0;
    this.level = this.startLevel;
    this.lines = 0;
    this.combo = -1;
    this.b2b = false;
    this.b2bCount = 0;
    this.quads = 0;
    this.allClears = 0;
    this.piecesPlaced = 0;
    this.gameOver = false;
    this.lastCallout = '';
    this.calloutTimer = 0;
    this.gravityTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.isGrounded = false;
    this.clearFlashTimer = 0;
    this.clearFlashRowsMask = 0;
    this.blastFlashTimer = 0;
    this.isNextSuper = false;
    this.isSuperActive = false;
    this.holdIsSuper = false;
    this.superBlasts = 0;
    this.nextSuperAtLines = 8;
    this.lastImpactX = 4.5;
    this.lastImpactY = 18;
    this.lastImpactKind = 0;
    this.impactNonce = 0;
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

  public getNextIds(out: [number, number, number]): void {
    for (let i = 0; i < 3; i++) {
      const idx = this.bagIndex + i;
      out[i] = idx < 7 ? this.bagA[idx] : this.bagB[idx - 7];
    }
  }

  public getMask(id: number, rot: number): number {
    return NC_PIECE_MASKS[(id << 2) | (rot & 3)];
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
        if (bx < 0 || bx >= NC_COLS || by >= NC_ROWS) return true;
        if (by >= 0 && (this.board[by] & (1 << bx)) !== 0) return true;
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
    const id = this.popBag();
    const superPiece = this.isNextSuper;
    this.isNextSuper = false;
    return this.spawnPiece(id, superPiece);
  }

  private spawnPiece(id: number, superPiece = false): boolean {
    this.activeId = id;
    this.isSuperActive = superPiece;
    this.activeRot = 0;
    this.activeX = 3;
    this.activeY = 0;
    this.gravityTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;

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
    if (this.gameOver) return false;
    const nx = this.activeX + dx;
    if (this.collides(this.activeId, this.activeRot, nx, this.activeY)) {
      return false;
    }
    this.activeX = nx;
    this.onTransformSuccess();
    return true;
  }

  public rotate(dir: 1 | -1 | 2): boolean {
    if (this.gameOver) return false;
    if (this.activeId === NoColorPieceId.O) return false;

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
          this.onTransformSuccess();
          return true;
        }
      }
      return false;
    }

    const table = this.activeId === NoColorPieceId.I ? I_KICKS : JLSTZ_KICKS;
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
    if (this.gameOver) return false;
    if (!this.collides(this.activeId, this.activeRot, this.activeX, this.activeY + 1)) {
      this.activeY++;
      this.score += 1;
      if (this.score > this.bestScore) this.bestScore = this.score;
      this.gravityTimer = 0;
      this.isGrounded = this.collides(this.activeId, this.activeRot, this.activeX, this.activeY + 1);
      this.boardRevision++;
      return true;
    }
    return false;
  }

  public hardDrop(): NoColorStepEvent {
    if (this.gameOver) return 'none';
    const dist = this.ghostY - this.activeY;
    if (dist > 0) {
      this.activeY = this.ghostY;
      this.score += dist * 2;
      if (this.score > this.bestScore) this.bestScore = this.score;
    }
    this.lastImpactX = this.activeX + 2;
    this.lastImpactY = this.activeY + 1.5;
    this.lastImpactKind = 0;
    this.impactNonce++;
    const ev = this.lockActivePiece();
    return ev === 'lock' ? 'hardDrop' : ev;
  }

  public hold(): boolean {
    if (this.gameOver || !this.canHold) return false;
    const current = this.activeId;
    const currentSuper = this.isSuperActive;
    if (this.holdId === NoColorPieceId.NONE) {
      this.holdId = current;
      this.holdIsSuper = currentSuper;
      this.spawnNext();
    } else {
      const swapped = this.holdId;
      const swappedSuper = this.holdIsSuper;
      this.holdId = current;
      this.holdIsSuper = currentSuper;
      this.spawnPiece(swapped, swappedSuper);
    }
    this.canHold = false;
    this.boardRevision++;
    return true;
  }

  public getFallInterval(): number {
    const exp = Math.min(19, this.level - 1);
    const speed = Math.pow(0.8 - exp * 0.007, exp);
    return Math.max(0.016, speed);
  }

  /**
   * Computes exact milliseconds until the next visual/simulation state transition
   * so Low-Power Mode can sleep instead of polling at 60Hz when idle.
   */
  public getNextWakeDelayMs(): number {
    if (this.gameOver) return 1000;
    if (this.clearFlashTimer > 0 || this.blastFlashTimer > 0) {
      return 16;
    }
    let nextSec = 1.0;
    if (this.isGrounded) {
      nextSec = Math.min(nextSec, Math.max(0.016, 0.5 - this.lockTimer));
    } else {
      const interval = this.getFallInterval();
      nextSec = Math.min(nextSec, Math.max(0.016, interval - this.gravityTimer));
    }
    if (this.calloutTimer > 0) {
      nextSec = Math.min(nextSec, Math.max(0.05, this.calloutTimer));
    }
    return Math.max(16, Math.ceil(nextSec * 1000));
  }

  public tick(dt: number): NoColorStepEvent {
    if (this.gameOver) return 'none';

    if (this.clearFlashTimer > 0) {
      this.clearFlashTimer = Math.max(0, this.clearFlashTimer - dt);
      if (this.clearFlashTimer === 0) {
        this.boardRevision++;
      }
    }

    if (this.blastFlashTimer > 0) {
      this.blastFlashTimer = Math.max(0, this.blastFlashTimer - dt);
      if (this.blastFlashTimer === 0) {
        this.boardRevision++;
      }
    }

    if (this.calloutTimer > 0) {
      this.calloutTimer = Math.max(0, this.calloutTimer - dt);
      if (this.calloutTimer === 0) {
        this.lastCallout = '';
        this.boardRevision++;
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

  private isBoardEmpty(): boolean {
    for (let r = 0; r < NC_ROWS; r++) {
      if (this.board[r] !== 0) return false;
    }
    return true;
  }

  private lockActivePiece(): NoColorStepEvent {
    const mask = this.getMask(this.activeId, this.activeRot);
    const wasSuper = this.isSuperActive;
    let anyVisible = false;
    let sumX = 0;
    let sumY = 0;
    let cellCount = 0;
    for (let r = 0; r < 4; r++) {
      const rowNibble = (mask >>> (r << 2)) & 0xf;
      if (rowNibble === 0) continue;
      const by = this.activeY + r;
      if (by < 0 || by >= NC_ROWS) continue;
      if (by >= NC_VISIBLE_START) anyVisible = true;
      for (let c = 0; c < 4; c++) {
        if ((rowNibble & (1 << c)) !== 0) {
          const bx = this.activeX + c;
          this.board[by] |= 1 << bx;
          sumX += bx + 0.5;
          sumY += by;
          cellCount++;
        }
      }
    }

    if (!anyVisible) {
      this.gameOver = true;
      this.boardRevision++;
      return 'gameOver';
    }

    this.piecesPlaced++;
    const impactCx = cellCount > 0 ? sumX / cellCount : this.activeX + 2;
    const impactCy = cellCount > 0 ? sumY / cellCount : this.activeY + 1;
    this.lastImpactX = impactCx;
    this.lastImpactY = impactCy;

    // Bitwise line clear scan (bottom to top) before 5x5 blast so full lines still score cleanly
    let cleared = 0;
    let writeRow = NC_ROWS - 1;
    let flashMask = 0;

    for (let readRow = NC_ROWS - 1; readRow >= 0; readRow--) {
      if (this.board[readRow] === NC_FULL_ROW) {
        cleared++;
        flashMask |= 1 << readRow;
      } else {
        this.board[writeRow] = this.board[readRow];
        writeRow--;
      }
    }
    while (writeRow >= 0) {
      this.board[writeRow] = 0;
      writeRow--;
    }

    let levelChanged = false;
    let callout = '';
    if (cleared > 0) {
      this.clearFlashRowsMask = flashMask;
      this.clearFlashTimer = 0.24;
      if (!wasSuper) {
        this.lastImpactKind = 1;
        this.impactNonce++;
      }
      this.combo++;

      let basePoints = cleared === 1 ? 100 : cleared === 2 ? 300 : cleared === 3 ? 500 : 800;
      callout = cleared === 1 ? 'SINGLE' : cleared === 2 ? 'DOUBLE' : cleared === 3 ? 'TRIPLE' : 'QUAD!';

      if (cleared === 4) {
        this.quads++;
        if (this.b2b) {
          basePoints = Math.floor(basePoints * 1.5);
          this.b2bCount++;
          callout = 'BACK-TO-BACK QUAD!';
          this.isNextSuper = true;
        }
        this.b2b = true;
      } else {
        this.b2b = false;
      }

      const comboBonus = this.combo > 0 ? 50 * this.combo * this.level : 0;
      if (this.combo > 0) {
        callout = `${callout} · ${this.combo} COMBO`;
      }

      let allClearBonus = 0;
      if (this.isBoardEmpty()) {
        this.allClears++;
        allClearBonus = cleared === 4 ? 3200 : 1800;
        callout = `${callout} · ALL CLEAR!`;
        this.isNextSuper = true;
      }

      this.score += (basePoints + allClearBonus) * this.level + comboBonus;
      if (this.score > this.bestScore) this.bestScore = this.score;

      const prevLevel = this.level;
      this.lines += cleared;
      this.level = Math.max(this.startLevel, Math.floor(this.lines / 10) + this.startLevel);
      levelChanged = this.level > prevLevel;

      if (this.lines >= this.nextSuperAtLines) {
        while (this.lines >= this.nextSuperAtLines) this.nextSuperAtLines += 8;
        this.isNextSuper = true;
      }
    } else {
      this.combo = -1;
    }

    // Super Block 5x5 Shockwave Blast on landing
    let blastedCells = 0;
    if (wasSuper) {
      this.isSuperActive = false;
      this.superBlasts++;
      const minX = Math.max(0, Math.floor(impactCx) - 2);
      const maxX = Math.min(NC_COLS - 1, Math.floor(impactCx) + 2);
      const minY = Math.max(NC_VISIBLE_START, Math.floor(impactCy) - 2);
      const maxY = Math.min(NC_ROWS - 1, Math.floor(impactCy) + 2);
      let clearColMask = 0;
      for (let x = minX; x <= maxX; x++) clearColMask |= 1 << x;
      for (let y = minY; y <= maxY; y++) {
        const hitBits = this.board[y] & clearColMask;
        if (hitBits !== 0) {
          let m = hitBits;
          while (m !== 0) {
            m &= m - 1;
            blastedCells++;
          }
          this.board[y] &= ~clearColMask;
        }
      }
      this.blastFlashTimer = 0.28;
      this.lastImpactKind = 2;
      this.impactNonce++;
      this.score += (blastedCells * 100 + 250) * this.level;
      if (this.score > this.bestScore) this.bestScore = this.score;
      callout = callout ? `SUPER BLAST! · ${callout}` : blastedCells > 0 ? `SUPER BLAST! +${blastedCells}` : 'SUPER BLAST!';
    } else if (cleared > 0 && this.isNextSuper) {
      callout = `${callout} · SUPER READY!`;
    }

    if (callout) {
      this.lastCallout = callout;
      this.calloutTimer = 1.35;
    }

    this.canHold = true;
    const spawned = this.spawnNext();
    this.boardRevision++;
    if (!spawned) {
      return 'gameOver';
    }

    if (wasSuper) return 'blast';
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
    // 44 bytes board + 14 bytes bags + 56 bytes masks + 200 bytes kicks = 314 bytes
    return (
      this.board.byteLength +
      this.bagA.byteLength +
      this.bagB.byteLength +
      NC_PIECE_MASKS.byteLength +
      JLSTZ_KICKS.byteLength +
      I_KICKS.byteLength +
      KICKS_180.byteLength
    );
  }

  public getSnapshot(): NoColorSnapshot {
    const nextIds: [number, number, number] = [0, 0, 0];
    this.getNextIds(nextIds);
    return {
      score: this.score,
      level: this.level,
      lines: this.lines,
      bestScore: this.bestScore,
      combo: Math.max(0, this.combo),
      b2b: this.b2b,
      b2bCount: this.b2bCount,
      quads: this.quads,
      allClears: this.allClears,
      superBlasts: this.superBlasts,
      isSuperActive: this.isSuperActive,
      isNextSuper: this.isNextSuper,
      piecesPlaced: this.piecesPlaced,
      lastCallout: this.calloutTimer > 0 ? this.lastCallout : '',
      gameOver: this.gameOver,
      holdId: this.holdId,
      holdIsSuper: this.holdIsSuper,
      canHold: this.canHold,
      nextIds,
      memoryBytes: this.getMemoryFootprintBytes(),
    };
  }
}
