import { Text, Box } from 'ink';
import type { ReactElement } from 'react';
import { PIXELS, COLORS } from './logo-data.js';

const { light: L } = COLORS;

interface LogoProps {
  /** Render each pixel as 2 characters wide for better aspect ratio (default: true) */
  readonly double?: boolean;
}

/**
 * Renders the pixel art octopus using colored block characters.
 */
export function Logo({ double = true }: LogoProps): ReactElement {
  const block = double ? '██' : '█';
  const space = double ? '  ' : ' ';

  return (
    <Box flexDirection="column">
      {PIXELS.map((row, y) => (
        <Box key={y}>
          {row.map((color, x) =>
            color !== null ? (
              <Text key={x} color={color}>
                {block}
              </Text>
            ) : (
              <Text key={x}>{space}</Text>
            ),
          )}
        </Box>
      ))}
    </Box>
  );
}

interface LogoHeaderProps {
  readonly version?: string;
}

/**
 * Compact inline header: octopus + "OnlyFence" + version.
 */
export function LogoHeader({ version }: LogoHeaderProps): ReactElement {
  return (
    <Box alignItems="center" gap={1}>
      <LogoSmall />
      <Text bold color={L}>
        OnlyFence
      </Text>
      {version !== undefined && <Text dimColor>v{version}</Text>}
    </Box>
  );
}

/**
 * 4-line compact logo using half-block characters (▀ ▄) to pack 8 rows into 4 lines.
 * Generated from the PIXELS grid — each terminal line combines two pixel rows.
 *
 * ▀ with color=top, backgroundColor=bottom → top half colored, bottom half colored
 * ▀ with color=top only                    → top half colored, bottom transparent
 * ▄ with color=bottom only                 → bottom half colored, top transparent
 * space                                     → both transparent
 */
export function LogoSmall(): ReactElement {
  const lines: ReactElement[] = [];

  for (let y = 0; y < PIXELS.length; y += 2) {
    const topRow = PIXELS[y] ?? [];
    const botRow = PIXELS[y + 1] ?? [];
    const cols = Math.max(topRow.length, botRow.length);
    const cells: ReactElement[] = [];

    for (let x = 0; x < cols; x++) {
      const top = topRow[x] ?? null;
      const bot = botRow[x] ?? null;

      if (top !== null && bot !== null) {
        cells.push(
          <Text key={x} color={top} backgroundColor={bot}>
            ▀
          </Text>,
        );
      } else if (top !== null) {
        cells.push(
          <Text key={x} color={top}>
            ▀
          </Text>,
        );
      } else if (bot !== null) {
        cells.push(
          <Text key={x} color={bot}>
            ▄
          </Text>,
        );
      } else {
        cells.push(<Text key={x}> </Text>);
      }
    }

    lines.push(<Box key={y}>{cells}</Box>);
  }

  return <Box flexDirection="column">{lines}</Box>;
}

interface LogoSplashProps {
  readonly version?: string;
  readonly tagline?: string;
  readonly align?: 'center' | 'flex-start';
}

/**
 * Full splash screen — shown on first run or `fence` with no args.
 */
export function LogoSplash({
  version,
  tagline = 'Agent wallet guardrails for DeFi',
  align = 'center',
}: LogoSplashProps): ReactElement {
  return (
    <Box flexDirection="column" alignItems={align} paddingY={1}>
      <Logo />
      <Box marginTop={1} gap={1}>
        <Text bold color={L}>
          OnlyFence
        </Text>
        {version !== undefined && <Text dimColor>v{version}</Text>}
      </Box>
      <Text dimColor>{tagline}</Text>
    </Box>
  );
}

export default Logo;
