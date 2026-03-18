/**
 * Terminal styling utilities for the OnlyFence CLI.
 *
 * Uses ANSI escape codes directly — no external dependencies.
 * Automatically disables colors when stdout is not a TTY.
 */

import { PIXELS, COLORS } from '../tui/components/logo-data.js';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isTTY is undefined when not a TTY
const isTTY: boolean = process.stdout.isTTY ?? false;

// ─── ANSI helpers ───────────────────────────────────────────────────────────

function ansi(code: string): (text: string) => string {
  if (!isTTY) return (text) => text;
  return (text) => `\x1b[${code}m${text}\x1b[0m`;
}

export const bold = ansi('1');
export const dim = ansi('2');
export const red = ansi('31');
export const green = ansi('32');
export const yellow = ansi('33');
export const cyan = ansi('36');

// ─── True-color ANSI ────────────────────────────────────────────────────────

/** Parse "#rrggbb" → [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Set foreground to a 24-bit hex color. */
function fg(hex: string): string {
  if (!isTTY) return '';
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** Set background to a 24-bit hex color. */
function bg(hex: string): string {
  if (!isTTY) return '';
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}

const RESET = isTTY ? '\x1b[0m' : '';

// ─── Semantic prefixes ──────────────────────────────────────────────────────

export function info(msg: string): void {
  console.log(`  ${cyan('i')} ${msg}`);
}

export function success(msg: string): void {
  console.log(`  ${green('✔')} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`  ${yellow('!')} ${msg}`);
}

export function error(msg: string): void {
  console.error(`  ${red('✖')} ${msg}`);
}

// ─── Step indicator ─────────────────────────────────────────────────────────

export function step(current: number, total: number, label: string): void {
  console.log(`\n  ${dim(`[${current}/${total}]`)} ${bold(label)}`);
}

// ─── Box drawing ────────────────────────────────────────────────────────────

/**
 * Print text inside a bordered box. Useful for important content
 * like mnemonic phrases or warnings.
 */
export function box(lines: readonly string[], color: (s: string) => string = dim): void {
  const visibleLengths = lines.map((l) => stripAnsi(l).length);
  const maxLen = Math.max(...visibleLengths);

  console.log(`  ${color('┌')}${color('─'.repeat(maxLen + 2))}${color('┐')}`);
  for (let i = 0; i < lines.length; i++) {
    const padded = (lines[i] ?? '') + ' '.repeat(maxLen - (visibleLengths[i] ?? 0));
    console.log(`  ${color('│')} ${padded} ${color('│')}`);
  }
  console.log(`  ${color('└')}${color('─'.repeat(maxLen + 2))}${color('┘')}`);
}

/** Remove ANSI escape sequences for length calculation. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ─── Logo ───────────────────────────────────────────────────────────────────

/**
 * Render the octopus pixel art as ANSI half-block lines.
 *
 * Uses the same technique as the TUI LogoSmall: ▀ packs two pixel rows
 * into one terminal row via foreground (top) and background (bottom) colors.
 *
 * Returns an array of strings (one per terminal line, 4 lines total).
 */
function renderOctopusLines(): string[] {
  const lines: string[] = [];

  for (let y = 0; y < PIXELS.length; y += 2) {
    const topRow = PIXELS[y] ?? [];
    const botRow = PIXELS[y + 1] ?? [];
    const cols = Math.max(topRow.length, botRow.length);
    let line = '';

    for (let x = 0; x < cols; x++) {
      const top = topRow[x] ?? null;
      const bot = botRow[x] ?? null;

      if (top !== null && bot !== null) {
        line += `${fg(top)}${bg(bot)}▀${RESET}`;
      } else if (top !== null) {
        line += `${fg(top)}▀${RESET}`;
      } else if (bot !== null) {
        line += `${fg(bot)}▄${RESET}`;
      } else {
        line += ' ';
      }
    }

    lines.push(line);
  }

  return lines;
}

/**
 * Print the OnlyFence logo matching the TUI header:
 * octopus pixel art on the left, title + tagline on the right.
 */
export function printLogo(version?: string): void {
  const octopus = renderOctopusLines();

  // Right-side text lines aligned to octopus rows
  const highlight = COLORS.light;
  const verStr = version !== undefined && version !== '' ? dim(`v${version}`) : '';
  const title = isTTY ? `\x1b[1m${fg(highlight)}OnlyFence${RESET}` : 'OnlyFence';
  const rightLines = ['', `${title} ${verStr}`, dim('AI Trading Guardrails'), ''];

  console.log('');
  for (let i = 0; i < octopus.length; i++) {
    const logo = octopus[i] ?? '';
    const text = rightLines[i] ?? '';
    console.log(`  ${logo}  ${text}`);
  }
  console.log('');
}
