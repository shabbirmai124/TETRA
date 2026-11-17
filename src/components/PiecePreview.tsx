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
          rects.push(
            <g key={`${r}-${c}`}>
              <rect
                x={x + 0.5}
                y={y + 0.5}
                width={cell - 1}
                height={cell - 1}
                rx={1}
                fill={dimmed ? '#334155' : theme.fill}
              />
              {/* 3D diagonal crystal specular facet */}
              <polygon
                points={`${x + 1},${y + 1} ${x + cell - 1},${y + 1} ${x + 1},${y + cell - 1}`}
                fill="rgba(255,255,255,0.22)"
              />
              {/* Top-left bright bevel */}
              <path
                d={`M ${x + 1} ${y + cell - 1.5} L ${x + 1} ${y + 1} L ${x + cell - 1.5} ${y + 1}`}
                fill="none"
                stroke={dimmed ? '#64748B' : theme.light}
                strokeWidth="1.5"
              />
              {/* Bottom-right dark bevel */}
              <path
                d={`M ${x + cell - 1.5} ${y + 1.5} L ${x + cell - 1.5} ${y + cell - 1.5} L ${x + 1.5} ${y + cell - 1.5}`}
                fill="none"
                stroke={dimmed ? '#1E293B' : theme.dark}
                strokeWidth="1.5"
              />
              {/* Inner crystal crown */}
              <rect
                x={x + 3.5}
                y={y + 3.5}
                width={cell - 7}
                height={cell - 7}
                fill="none"
                stroke={dimmed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.48)'}
                strokeWidth="0.8"
              />
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
