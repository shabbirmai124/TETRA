# TETRA — No Color & Color Editions

![TETRA — No Color and Color Editions Banner](src/assets/images/tetra_readme_banner_1794887580705.jpg)

> **Created by:** **Md Shabbir Mia** ([shabbirmia520@gmail.com](mailto:shabbirmia520@gmail.com))  
> **License:** [MIT License](./LICENSE)

**TETRA** is an original, high-efficiency falling-block puzzle suite written in strict **TypeScript** with **TypedArrays**, **Canvas 2D**, and **procedural Web Audio**. It ships as **two individual, standalone game engines and folders**—one minimalist white-and-black engine engineered for minimal RAM and battery draw, and one full-color competitive engine packing complete modern mechanics, particle bursts, and four distinct game modes.

---

## Visual Showcase

| **No Color Edition (`no-color/`)** | **Color Advanced Edition (`color/`)** |
| :---: | :---: |
| ![TETRA No Color Edition Showcase](src/assets/images/tetra_nocolor_showcase_1794891715954.jpg) | ![TETRA Color Edition Showcase](src/assets/images/tetra_color_showcase_1794891720472.jpg) |
| *44-byte bitboard · Pure `#000000` / `#FFFFFF` · Event-driven idle sleep* | *Faceted jewel bevels · T-Spins · Pooled particle bursts · 4 Game Modes* |

---

## Two Individual Game Folders

### 1. `no-color/` — White & Black Edition (`no-color/engine.ts` + `no-color/NoColorGame.tsx`)
Engineered from the ground up for ultra-low memory consumption, minimal battery/CPU draw, and stark monochrome clarity:
- **44-Byte Row Bitboard (`Uint16Array(22)`)**: Each row of the 10×22 matrix is stored as a single 16-bit integer (bits `0..9`), enabling O(1) bitwise collision checks and instant full-row detection (`row === 0x3FF`).
- **Packed 4×4 Piece Masks & Flat Kick Tables**: All 28 piece rotation states reside in a 56-byte `Uint16Array`, while SRS + 180° wall kicks reside in flat `Int8Array` lookup tables.
- **Event-Driven Low-Power Mode**:
  - Computes the exact millisecond delay until the next gravity step, lock timer, or callout expiry via `getNextWakeDelayMs()`, sleeping with `setTimeout` instead of spinning a 60 Hz `requestAnimationFrame` loop while idle.
  - Drops to **0% CPU** when paused or on Game Over (canceling all timers and animation frames).
  - Pre-renders static grid lines onto an offscreen canvas (`drawImage()` blit) and skips redundant GPU uploads via `boardRevision` dirty-checking on an opaque `{ alpha: false }` Canvas 2D backbuffer.
  - Maintains **0 ms input latency** by triggering synchronous canvas updates immediately on keydown or touch.
- **Complete Classic & Modern Ruleset**: 7-bag randomizer (`Uint8Array`), Hold piece, 3-piece Next queue, dashed Ghost piece, SRS + 180° rotation (`A`), Back-to-Back Quads (1.5×), Combo chains, All Clear bonuses, configurable Start Level `1–15`, and local best-score persistence.

### 2. `color/` — Advanced Modern Color Edition (`color/engine.ts` + `color/ColorGame.tsx`)
Built for high-speed competitive play, crisp visual feedback, and adaptive power efficiency:
- **240-Byte Compact Matrix (`Uint8Array(240)`)**: Stores the 10×24 playfield (rows `0..3` spawn buffer + rows `4..23` visible matrix) using 1 byte per cell.
- **Zero-GC Pooled Particle Ring Buffer**: Pre-allocated `Float32Array(64 * 7)` (1,792 bytes, zero runtime allocations) drives hard-drop sparks and line-clear bursts alongside 45 ms hitstop, line-clear flash sweeps, and decaying `trauma²` camera shake.
- **Adaptive Low-Power Scheduler & Cached Grid**: Uses an opaque `{ alpha: false }` canvas, blits the cached offscreen matrix grid, and automatically exits 60 FPS `requestAnimationFrame` into event-driven `getNextWakeDelayMs()` sleep whenever particles/shake settle and no movement keys are held.
- **Full Super Rotation System (SRS) + 180°**: Complete CW, CCW, and 180° rotation with JLSTZ, I, and 180° kick tables.
- **T-Spin & Mini T-Spin Detection**: Implements the 3-corner T-slot rule around the T-piece center with front-corner + 5th kick verification (`T-Spin Zero`, `Mini`, `Single`, `Double`, `Triple`).
- **Back-to-Back (B2B), Combo (Ren) & All Clear**: 1.5× multiplier on consecutive Quads or T-Spin line clears, escalating `50 × combo × level` chains, and Perfect Clear bonuses (`+1800` / `+3200 × level`).
- **4 Distinct Game Modes**:
  - **Marathon** — Classic climb through accelerating gravity curves toward 150 lines (Start Level `1–15`).
  - **Sprint 40L** — Clear 40 lines as fast as possible with live **PPS** (Pieces Per Second) and elapsed timer.
  - **Ultra 2:00** — Score attack under a strict 2-minute countdown clock.
  - **Zen** — Relaxed endless mode with gentle constant gravity.
- **Competitive Handling Tuning**: Real-time **DAS** (`70–220 ms`), **ARR** (`0–60 ms`, including `0 ms` instant slide), and **SDF** (`4×–40×`) sliders inside Options, plus 5-piece Next queue, Hold slot, 500 ms Lock Delay (15-reset cap), and original procedural Web Audio synthesis (`src/audio/synth.ts`).

---

## Complete Technical Specifications

### Memory Architecture

| Subsystem | `no-color/` Edition | `color/` Edition | Notes |
| :--- | :--- | :--- | :--- |
| **Playfield Matrix** | `Uint16Array(22)` — **44 bytes** | `Uint8Array(240)` — **240 bytes** | 10×22 bitboard vs. 10×24 per-cell color IDs |
| **7-Bag Buffers** | `Uint8Array(14)` — **14 bytes** | `Uint8Array(14)` — **14 bytes** | Dual pre-allocated Fisher–Yates bags (zero GC) |
| **Piece Bitmasks** | `Uint16Array(28)` — **56 bytes** | `Uint16Array(28)` — **56 bytes** | 4×4 rotation masks packed into 16 bits |
| **Clearing Row Flags** | Bitwise `number` register | `Uint8Array(24)` — **24 bytes** | Row-clear flash tracking |
| **Particle Ring Pool** | None (0 bytes) | `Float32Array(64 × 7)` — **1,792 bytes** | Fixed circular buffer, zero heap churn |
| **Canvas Backbuffer** | `{ alpha: false }` + Offscreen Grid Cache | `{ alpha: false }` + Offscreen Grid Cache | Single `drawImage()` grid blit + dirty check |

### Scoring & Multiplier Specification

| Action | Base Points (`× Level`) | Back-to-Back Eligible |
| :--- | :--- | :--- |
| **Soft Drop / Hard Drop** | `1 pt / cell` · `2 pts / cell` | No |
| **Single / Double / Triple** | `100` · `300` · `500` | Resets B2B |
| **Quad (4-Line Clear)** | `800` | Yes (`1.5×` = `1,200`) |
| **Mini T-Spin (0 / 1 Line)** *(Color)* | `100` · `200` | Yes on line clear (`1.5×`) |
| **T-Spin (0 / 1 / 2 / 3 Lines)** *(Color)* | `400` · `800` · `1,200` · `1,600` | Yes on line clear (`1.5×`) |
| **Combo Chain (Ren)** | `+50 × combo × level` | Stacks with B2B |
| **All Clear (Perfect Clear)** | `+1,800` (1–3L) / `+3,200` (Quad) | Stacks with B2B & Combo |

### Gravity, Lock Delay & Handling Specs
- **Gravity Curve**: `interval(level) = max(0.015s, (0.8 - (L - 1) × 0.007)^(L - 1))` where `L = min(19, level - 1)` (constant `0.9s` in Zen mode).
- **Lock Delay**: `500 ms` grounded grace period with up to **15 movement/rotation resets** before forced lock.
- **PRNG**: Deterministic 32-bit Xorshift (`rngState`) for reproducible seeded runs and unit tests.
- **Default Handling**: `DAS = 135 ms`, `ARR = 20 ms`, `SDF = 18×`, `Low Power Mode = ON`, `180° Rotate = ON`.

---

## Controls

| Action | Keyboard | Mobile / Touch |
| :--- | :--- | :--- |
| Move Left / Right | `←` / `→` | On-screen `←` / `→` |
| Soft Drop | `↓` | On-screen `↓` |
| Hard Drop | `Space` | On-screen `DROP` |
| Rotate Clockwise | `↑` or `X` | On-screen `↻` |
| Rotate Counter-Clockwise | `Z` or `Ctrl` | — |
| Rotate 180° | `A` | — |
| Hold Piece | `C` or `Shift` | On-screen `HOLD` |
| Pause / Options / How to Play | `Esc` or `P` | Bottom-right `Pause` |
| Quick Restart | `R` | Top-right `Restart` |

---

## Project Structure

```text
├── no-color/                        # Standalone White & Black falling-block folder
│   ├── engine.ts                    # 44-byte bitboard engine & wake scheduler
│   ├── engine.test.ts               # Unit tests (node:test)
│   └── NoColorGame.tsx              # Monochrome Canvas2D renderer & low-power loop
├── color/                           # Standalone Color Advanced Modern folder
│   ├── engine.ts                    # Advanced SRS / T-Spin / B2B / Particle pool engine
│   ├── engine.test.ts               # Unit tests (node:test)
│   └── ColorGame.tsx                # Faceted jewel Canvas2D renderer & adaptive loop
├── src/
│   ├── audio/
│   │   └── synth.ts                 # Original procedural Web Audio API synthesizer
│   ├── components/
│   │   ├── Modals.tsx               # Pause, Options, How to Play, Victory/Game Over modals
│   │   ├── PiecePreview.tsx         # Lightweight SVG Hold/Next piece preview
│   │   └── TitleScreen.tsx          # Title stage with live centerpiece & edition switch
│   ├── types/
│   │   └── game.ts                  # Shared shell & options types
│   └── App.tsx                      # Full-viewport Game Shell state machine
├── LICENSE                          # Full MIT License (Md Shabbir Mia)
└── README.md                        # Complete documentation & specifications
```

---

## Development & Verification

```bash
# Install dependencies
npm install

# Start development server (port 3000)
npm run dev

# Run deterministic unit tests for both engines
npm test

# Type-check and production build
npm run lint
npm run build
```

---

## Author & Contact

- **Author:** Md Shabbir Mia
- **Email:** [shabbirmia520@gmail.com](mailto:shabbirmia520@gmail.com)

## Legal & Independence Notice

- **Original Open-Source Code**: All game logic, TypedArray engines, Canvas 2D rendering, UI components, and procedural Web Audio synthesizer tones in this repository are original implementations created by Md Shabbir Mia.
- **No Third-Party Trademarks or Copyrighted Assets**: **TETRA** is an independent, non-commercial open-source falling-block puzzle project. It is not affiliated with, endorsed by, or sponsored by any third-party brand or rights holder, and contains no external audio files, copyrighted sprites, or proprietary assets.

## License

Licensed under the **MIT License**. See the complete [`LICENSE`](./LICENSE) file for full terms and conditions.
