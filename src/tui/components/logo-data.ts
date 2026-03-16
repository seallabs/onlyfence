/**
 * OnlyFence logo — raw pixel data (Design B).
 *
 * 9 columns × 8 rows. Each cell is a hex color string or null (transparent).
 * Reusable for generating any format: SVG, PNG, canvas, ANSI, braille, etc.
 */

export const LOGO_WIDTH = 9;
export const LOGO_HEIGHT = 8;

export const COLORS = {
  light: '#60a5fa', // head top, tentacle tips
  mid: '#3b82f6', // body fill
  dark: '#2563eb', // shadow band, tentacle mid
  eye: '#e0f2fe', // eye highlight
} as const;

const { light: L, mid: M, dark: D, eye: E } = COLORS;
const _ = null;

/** Row-major pixel grid. PIXELS[y][x] = hex color | null */
export const PIXELS: (string | null)[][] = [
  [_, _, L, L, L, L, L, _, _], // 0: head top
  [_, M, M, M, M, M, M, M, _], // 1: head fill
  [_, M, E, M, D, M, E, M, _], // 2: eyes
  [_, M, M, M, M, M, M, M, _], // 3: lower head
  [_, D, D, D, D, D, D, D, _], // 4: body band
  [M, _, M, M, _, M, M, _, M], // 5: upper tentacles
  [D, _, D, _, M, _, D, _, D], // 6: mid tentacles
  [L, _, L, _, L, _, L, _, L], // 7: tentacle tips
];
