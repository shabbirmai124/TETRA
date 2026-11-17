import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NoColorEngine,
  NoColorPieceId,
  NC_ROWS,
  NC_FULL_ROW,
} from './engine';

test('NoColorEngine allocates ultra-low memory bitboard (< 512 bytes)', () => {
  const engine = new NoColorEngine(1234);
  assert.equal(engine.board.byteLength, NC_ROWS * 2); // 44 bytes
  assert.ok(engine.getMemoryFootprintBytes() < 512);
});

test('NoColorEngine 7-bag produces all 7 unique pieces in first 7 spawns', () => {
  const engine = new NoColorEngine(42);
  const seen = new Set<number>();
  for (let i = 0; i < 7; i++) {
    seen.add(engine.activeId);
    engine.hardDrop();
  }
  assert.equal(seen.size, 7);
});

test('NoColorEngine bitwise line clear removes full rows and scores correctly', () => {
  const engine = new NoColorEngine(77);
  // Pre-fill bottom row except columns 3..6, then drop an I piece horizontally
  engine.board[NC_ROWS - 1] = NC_FULL_ROW & ~(0b1111 << 3);
  engine.activeId = NoColorPieceId.I;
  engine.activeRot = 0; // horizontal row 1 of 4x4 mask occupies cols +0..+3
  engine.activeX = 3;
  engine.activeY = 2;
  engine.move(-1);
  engine.move(1);

  const ev = engine.hardDrop();
  assert.equal(ev, 'line1');
  assert.equal(engine.lines, 1);
  assert.equal(engine.allClears, 1);
  assert.equal(engine.board[NC_ROWS - 1], 0);
  assert.ok(engine.score >= 1900);
});

test('NoColorEngine supports 180-degree rotation and Back-to-Back Quads', () => {
  const engine = new NoColorEngine(88, 0, 2);
  assert.equal(engine.level, 2);
  engine.activeId = NoColorPieceId.T;
  engine.activeRot = 0;
  engine.activeX = 3;
  engine.activeY = 5;
  assert.equal(engine.rotate(2), true);
  assert.equal(engine.activeRot, 2);

  const fillFourRowsWithGap = (gapCol: number) => {
    for (let r = NC_ROWS - 4; r < NC_ROWS; r++) {
      engine.board[r] = NC_FULL_ROW & ~(1 << gapCol);
    }
    engine.board[NC_ROWS - 5] = 1 << 9; // prevent All Clear
  };

  fillFourRowsWithGap(0);
  engine.activeId = NoColorPieceId.I;
  engine.activeRot = 3;
  engine.activeX = -1;
  engine.activeY = 2;
  engine.move(1);
  engine.move(-1);
  assert.equal(engine.hardDrop(), 'quad');
  assert.equal(engine.b2b, true);

  fillFourRowsWithGap(0);
  engine.activeId = NoColorPieceId.I;
  engine.activeRot = 3;
  engine.activeX = -1;
  engine.activeY = 2;
  engine.move(1);
  engine.move(-1);
  assert.equal(engine.hardDrop(), 'quad');
  assert.equal(engine.b2bCount, 1);
  assert.equal(engine.quads, 2);
});

test('NoColorEngine hold swaps once per drop and resets on lock', () => {
  const engine = new NoColorEngine(99);
  const firstId = engine.activeId;
  assert.equal(engine.hold(), true);
  assert.equal(engine.holdId, firstId);
  assert.equal(engine.canHold, false);
  assert.equal(engine.hold(), false);

  engine.hardDrop();
  assert.equal(engine.canHold, true);
  assert.equal(engine.hold(), true);
  assert.equal(engine.activeId, firstId);
});

test('NoColorEngine getNextWakeDelayMs returns exact sleep window for Low-Power Mode', () => {
  const engine = new NoColorEngine(123);
  const delay = engine.getNextWakeDelayMs();
  // Level 1 gravity is ~1000ms, so wake delay is around 1000ms (never tight 16ms polling while idle)
  assert.ok(delay >= 500 && delay <= 1050);
});

test('NoColorEngine detects top-out game over when spawn is blocked', () => {
  const engine = new NoColorEngine(55);
  for (let r = 0; r < 6; r++) {
    engine.board[r] = NC_FULL_ROW & ~1;
  }
  const ev = engine.hardDrop();
  assert.equal(ev, 'gameOver');
  assert.equal(engine.gameOver, true);
});
