import React from 'react';
import { COLOR_PIECE_THEMES, C_PIECE_MASKS, ColorPieceId } from '../../color/engine';
import { NC_PIECE_MASKS, NoColorPieceId } from '../../no-color/engine';

interface PiecePreviewProps {
  edition: 'no-color' | 'color';
  pieceId: number;
  isSuper?: boolean;
  dimmed?: boolean;
  size?: 'sm' | 'md';
}

export const PiecePreview: React.FC<PiecePreviewProps> = React.memo(
  ({ edition, pieceId, isSuper = false, dimmed = false, size = 'md' }) => {
    const isEmpty =
      edition === 'no-color'
        ? pieceId === NoColorPieceId.NONE || pieceId < 0 || pieceId > 6
        : pieceId === ColorPieceId.NONE || pieceId < 1 || pieceId > 7;

    const pxSize = size === 'sm' ? 54 : 72;

    if (isEmpty) {
      return (
        <div
          style={{ width: pxSize, height: size === 'sm' ? 38 : 50 }}
          className="flex items-center justify-center"
          aria-hidden="true"
        />
      );
    }

    const mask =
      edition === 'no-color'
        ? NC_PIECE_MASKS[(pieceId << 2) | 0]
        : C_PIECE_MASKS[((pieceId - 1) << 2) | 0];

    // Compute tight bounding box of the 4x4 mask so piece is visually centered
    let minC = 4;
    let maxC = -1;
    let minR = 4;
    let maxR = -1;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if ((mask & (1 << (r * 4 + c))) !== 0) {
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
        }
      }
    }

    const cols = maxC - minC + 1;
    const rows = maxR - minR + 1;
    const cell = size === 'sm' ? 12 : 16;
    const width = cols * cell;
    const height = rows * cell;
    const theme = edition === 'color' ? COLOR_PIECE_THEMES[isSuper ? 8 : pieceId] : null;

    const rects: React.ReactNode[] = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if ((mask & (1 << (r * 4 + c))) === 0) continue;
        const x = (c - minC) * cell;
        const y = (r - minR) * cell;

        if (edition === 'no-color') {
          if (isSuper && !dimmed) {
            rects.push(
              <g key={`${r}-${c}`}>
                <rect x={x + 0.5} y={y + 0.5} width={cell - 1} height={cell - 1} fill="#FFFFFF" stroke="#000000" strokeWidth="1" />
                <rect x={x + 3} y={y + 3} width={cell - 6} height={cell - 6} fill="#111111" />
                <polygon
                  points={`${x + cell / 2},${y + 3.5} ${x + cell - 3.5},${y + cell / 2} ${x + cell / 2},${y + cell - 3.5} ${x + 3.5},${y + cell / 2}`}
                  fill="#FFFFFF"
                />
              </g>,
            );
          } else {
            rects.push(
              <g key={`${r}-${c}`}>
                <rect
                  x={x + 0.5}
                  y={y + 0.5}
                  width={cell - 1}
                  height={cell - 1}
                  fill={dimmed ? '#121212' : '#191919'}
                  stroke={dimmed ? '#6B6B6B' : '#FFFFFF'}
                  strokeWidth="1"
                />
                <rect
                  x={x + 3}
                  y={y + 3}
                  width={cell - 6}
                  height={cell - 6}
                  fill="none"
                  stroke={dimmed ? '#4A4A4A' : '#A3A3A3'}
                  strokeWidth="0.9"
                />
                <line
                  x1={x + cell / 2}
                  y1={y + 3}
                  x2={x + cell / 2}
                  y2={y + cell - 3}
                  stroke="#525252"
                  strokeWidth="0.75"
                />
              </g>,
            );
          }
        } else if (theme) {
          const inset = Math.max(3, Math.round(cell * 0.25));
          const x1 = x + 0.5;
          const y1 = y + 0.5;
          const x2 = x + cell - 0.5;
          const y2 = y + cell - 0.5;
          const ix1 = x + inset;
          const iy1 = y + inset;
          const ix2 = x + cell - inset;
          const iy2 = y + cell - inset;

          const baseFill = dimmed ? '#334155' : theme.fill;
          const lightFacet = dimmed ? '#64748B' : theme.light;
          const darkFacet = dimmed ? '#1E293B' : theme.dark;

          rects.push(
            <g key={`${r}-${c}`}>
              {/* Deep obsidian housing + radiant diamond core */}
              <rect x={x} y={y} width={cell} height={cell} fill="#05080F" />
              <rect x={x1} y={y1} width={cell - 1} height={cell - 1} fill={baseFill} />

              {/* 4-way pyramidal diamond cut facets */}
              <polygon points={`${x1},${y1} ${x2},${y1} ${ix2},${iy1} ${ix1},${iy1}`} fill={lightFacet} />
              <polygon points={`${x1},${y1} ${ix1},${iy1} ${ix1},${iy2} ${x1},${y2}`} fill={lightFacet} opacity="0.72" />
              <polygon points={`${x2},${y1} ${x2},${y2} ${ix2},${iy2} ${ix2},${iy1}`} fill={darkFacet} opacity="0.65" />
              <polygon points={`${x1},${y2} ${x2},${y2} ${ix2},${iy2} ${ix1},${iy2}`} fill={darkFacet} />

              {/* Top specular gleam */}
              {!dimmed && <rect x={x + 1} y={y + 0.5} width={cell - 2} height={1.2} fill="rgba(255,255,255,0.62)" />}

              {/* Diagonal corner cut ribs */}
              <line x1={x1} y1={y1} x2={ix1} y2={iy1} stroke="rgba(255,255,255,0.45)" strokeWidth="0.75" />
              <line x1={x2} y1={y1} x2={ix2} y2={iy1} stroke="rgba(255,255,255,0.45)" strokeWidth="0.75" />
              <line x1={x1} y1={y2} x2={ix1} y2={iy2} stroke="rgba(255,255,255,0.45)" strokeWidth="0.75" />
              <line x1={x2} y1={y2} x2={ix2} y2={iy2} stroke="rgba(255,255,255,0.45)" strokeWidth="0.75" />

              {/* Center jewel table + crystal glint triangle */}
              <rect x={ix1} y={iy1} width={ix2 - ix1} height={iy2 - iy1} fill={baseFill} />
              <polygon
                points={`${ix1},${iy1} ${ix2},${iy1} ${ix1},${iy2}`}
                fill={dimmed ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.38)'}
              />
              <rect
                x={ix1}
                y={iy1}
                width={ix2 - ix1}
                height={iy2 - iy1}
                fill="none"
                stroke={dimmed ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.72)'}
                strokeWidth="0.75"
              />

              {/* White crystal star sparkle */}
              {!dimmed && <rect x={x + 1.5} y={y + 1.5} width={2} height={2} fill="#FFFFFF" />}
              {isSuper && !dimmed && (
                <polygon
                  points={`${x + cell / 2},${y + 3} ${x + cell - 3},${y + cell / 2} ${x + cell / 2},${y + cell - 3} ${x + 3},${y + cell / 2}`}
                  fill="#FFFFFF"
                />
              )}
            </g>,
          );
        }
      }
    }

    return (
      <div
        style={{ width: pxSize, height: size === 'sm' ? 38 : 50 }}
        className="flex items-center justify-center"
        aria-hidden="true"
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {rects}
        </svg>
      </div>
    );
  },
);

PiecePreview.displayName = 'PiecePreview';
