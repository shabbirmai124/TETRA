import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ColorEngine,
  ColorPieceId,
  C_COLS,
  C_ROWS,
  C_VISIBLE_START,
} from './engine';

test('ColorEngine initializes cleanly with 5-piece preview and zeroed board', () => {
  const engine = new ColorEngine('marathon', 101);
  const snap = engine.getSnapshot();
  assert.equal(snap.mode, 'marathon');
  assert.equal(snap.nextIds.length, 5);
  assert.equal(snap.score, 0);
  assert.equal(snap.lines, 0);
  assert.equal(engine.board.byteLength, C_COLS * C_ROWS);
});

test('ColorEngine detects full T-Spin Double and awards 1200 * level', () => {
  const engine = new ColorEngine('marathon', 202);
  // Construct a classic T-Spin Double overhang in rows 22 & 23
  // Row 22: [X, X, ., ., ., X, X, X, X, X] -> wait, T at x=2, y=21 (center = x=3, y=22)
  // Let's clear board and build exact T-slot centered at (cx=4, cy=22):
  // Piece T at activeX=3, activeY=21:
  // rot 2 (pointing down): row1=(3..5, y=22), row2=(4, y=23)
  engine.board.fill(0);
  // Fill row 23 except col 4
  for (let x = 0; x < C_COLS; x++) {
    if (x !== 4) engine.board[23 * C_COLS + x] = ColorPieceId.J;
  }
  // Fill row 22 except cols 3, 4, 5
  for (let x = 0; x < C_COLS; x++) {
    if (x < 3 || x > 5) engine.board[22 * C_COLS + x] = ColorPieceId.J;
  }
  // Overhang corner at (3, 21) so 3 corners around (4, 22) are filled:
  // (3,21)=occupied, (3,23)=occupied, (5,23)=occupied -> 3 corners!
  // Wait: for rot=2 (down), front corners are (3,23) and (5,23) -> both occupied => FULL T-SPIN!
  engine.board[21 * C_COLS + 3] = ColorPieceId.L;

  engine.activeId = ColorPieceId.T;
  engine.activeRot = 1; // rotate CW -> rot 2
  engine.activeX = 3;
  engine.activeY = 21;

  const rotated = engine.rotate(1);
  assert.equal(rotated, true);
  assert.equal(engine.activeRot, 2);
  assert.equal(engine.detectTSpin(), 'full');

  const ev = engine.hardDrop();
  assert.equal(ev, 'tspin');
  assert.equal(engine.lines, 2);
  assert.equal(engine.tSpins, 1);
  assert.equal(engine.b2b, true);
  assert.equal(engine.score, 1200);
});

test('ColorEngine Back-to-Back awards 1.5x multiplier on consecutive Quads', () => {
  const engine = new ColorEngine('marathon', 303);
  const fillFourRowsWithGap = (gapCol: number) => {
    for (let y = C_ROWS - 4; y < C_ROWS; y++) {
      for (let x = 0; x < C_COLS; x++) {
        engine.board[y * C_COLS + x] = x === gapCol ? 0 : ColorPieceId.S;
      }
    }
    engine.board[(C_ROWS - 5) * C_COLS + 9] = ColorPieceId.O;
  };

  // First Quad (800 pts + 18*2 hardDrop = 836)
  fillFourRowsWithGap(0);
  engine.activeId = ColorPieceId.I;
  engine.activeRot = 3; // vertical at col x+1 => activeX=-1 places it at col 0
  engine.activeX = -1;
  engine.activeY = 2;
  engine.move(1);
  engine.move(-1);
  const ev1 = engine.hardDrop();
  assert.equal(ev1, 'quad');
  assert.equal(engine.b2b, true);
  const scoreAfterFirst = engine.score;
  assert.equal(scoreAfterFirst, 836);

  // Second consecutive Quad (B2B 1200 + 1-Combo 50 + 18*2 hardDrop = 1286)
  fillFourRowsWithGap(0);
  engine.activeId = ColorPieceId.I;
  engine.activeRot = 3;
  engine.activeX = -1;
  engine.activeY = 2;
  engine.move(1);
  engine.move(-1);
  const ev2 = engine.hardDrop();
  assert.equal(ev2, 'quad');
  assert.equal(engine.b2bCount, 1);
  assert.equal(engine.combo, 1);
  assert.equal(engine.score - scoreAfterFirst, 1286);
});

test('ColorEngine detects Perfect Clear (All Clear) bonus', () => {
  const engine = new ColorEngine('marathon', 404);
  engine.board.fill(0);
  for (let x = 0; x < C_COLS; x++) {
    if (x < 3 || x > 6) engine.board[(C_ROWS - 1) * C_COLS + x] = ColorPieceId.Z;
  }
  engine.activeId = ColorPieceId.I;
  engine.activeRot = 0;
  engine.activeX = 3;
  engine.activeY = 2;
  engine.move(1);
  engine.move(-1);
  engine.hardDrop();
  assert.equal(engine.allClears, 1);
  assert.ok(engine.score >= 1900);
});

test('ColorEngine Sprint 40L triggers victory at 40 lines and Ultra expires at 120s', () => {
  const sprint = new ColorEngine('sprint', 505);
  sprint.lines = 39;
  for (let x = 0; x < C_COLS; x++) {
    if (x < 3 || x > 6) sprint.board[(C_ROWS - 1) * C_COLS + x] = ColorPieceId.I;
  }
  sprint.activeId = ColorPieceId.I;
  sprint.activeRot = 0;
  sprint.activeX = 3;
  sprint.activeY = 2;
  sprint.move(1);
  sprint.move(-1);
  const ev = sprint.hardDrop();
  assert.equal(ev, 'victory');
  assert.equal(sprint.victory, true);

  const ultra = new ColorEngine('ultra', 606);
  const uEv = ultra.tick(121);
  assert.equal(uEv, 'victory');
  assert.equal(ultra.victory, true);
  assert.equal(ultra.remainingSec, 0);
});

test('ColorEngine rewards Super Block, preserves holdIsSuper, triggers 5x5 Blast, and emits fire sparks', () => {
  const engine = new ColorEngine('marathon', 707);
  engine.board.fill(0);
  for (let x = 0; x < C_COLS; x++) {
    if (x < 3 || x > 6) engine.board[(C_ROWS - 1) * C_COLS + x] = ColorPieceId.S;
  }

  engine.activeId = ColorPieceId.I;
  engine.activeRot = 0;
  engine.activeX = 3;
  engine.activeY = 2;
  engine.move(1);
  engine.move(-1);
  assert.equal(engine.hardDrop(), 'line1');
  assert.equal(engine.allClears, 1);
  assert.equal(engine.isSuperActive, true);

  assert.equal(engine.hold(), true);
  assert.equal(engine.holdIsSuper, true);
  assert.equal(engine.isSuperActive, false);

  engine.hardDrop();
  assert.equal(engine.hold(), true);
  assert.equal(engine.isSuperActive, true);

  // Fill cells around center (col 2..6, bottom row) on a clean board and hard drop O-piece Super Block
  engine.board.fill(0);
  for (let x = 2; x <= 6; x++) {
    engine.board[(C_ROWS - 1) * C_COLS + x] = ColorPieceId.Z;
  }
  engine.activeId = ColorPieceId.O;
  engine.activeRot = 0;
  engine.activeX = 3;
  engine.activeY = 2;
  engine.move(1);
  engine.move(-1);
  const ev = engine.hardDrop();
  assert.equal(ev, 'blast');
  assert.equal(engine.superBlasts, 1);
  assert.equal(engine.board[(C_ROWS - 1) * C_COLS + 4], 0);
  assert.equal(engine.board[(C_ROWS - 1) * C_COLS + 5], 0);
  engine.tick(0.016);
  assert.ok(engine.activeParticlesCount > 0);
});

test('ColorEngine triggers 2x Overdrive Rush, Clutch Save, and progressive Rank tiers', () => {
  const engine = new ColorEngine('marathon', 909);
  assert.equal(engine.getRank(), 'D');

  // Danger block near ceiling triggers Clutch Save (+250) + fills feverCharge over 100
  engine.board[C_VISIBLE_START * C_COLS + 0] = ColorPieceId.L;
  for (let x = 0; x < C_COLS; x++) {
    if (x < 3 || x > 6) engine.board[(C_ROWS - 1) * C_COLS + x] = ColorPieceId.I;
  }
  engine.feverCharge = 85;
  engine.activeId = ColorPieceId.I;
  engine.activeRot = 0;
  engine.activeX = 3;
  engine.activeY = 2;
  engine.move(1);
  engine.move(-1);

  const ev = engine.hardDrop();
  assert.equal(ev, 'overdrive');
  assert.equal(engine.overdriveTimer, 12);
  assert.equal(engine.getSnapshot().isOverdrive, true);

  // Subsequent single line clear gets 2x Overdrive multiplier
  const prevScore = engine.score;
  engine.board.fill(0);
  for (let x = 0; x < C_COLS; x++) {
    if (x < 3 || x > 6) engine.board[(C_ROWS - 1) * C_COLS + x] = ColorPieceId.T;
  }
  engine.board[(C_ROWS - 2) * C_COLS + 9] = ColorPieceId.O;
  engine.activeId = ColorPieceId.I;
  engine.activeRot = 0;
  engine.activeX = 3;
  engine.activeY = 2;
  engine.move(1);
  engine.move(-1);
  assert.equal(engine.hardDrop(), 'line1');
  // 20 rows hardDrop (40 pts) + (100 single + 50 combo) * 2x = 340
  assert.equal(engine.score - prevScore, 340);
  assert.equal(engine.getSnapshot().superProgress, 2);

  engine.score = 100500;
  assert.equal(engine.getRank(), 'X');

  engine.tick(13);
  assert.equal(engine.overdriveTimer, 0);
  assert.equal(engine.getSnapshot().isOverdrive, false);
});

