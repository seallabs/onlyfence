# OnlyFence Logo — Blue Octopus

Pixel art logo inspired by the Claude Code aesthetic. 9x8 pixel grid, crisp edges, terminal-friendly.

## Directory Structure

```
static/img/logo/
├── svg/
│   └── logo.svg              # Base vector, scales to any size
├── png/
│   ├── logo-{72,128,256,512}.png        # Natural aspect ratio
│   └── logo-square-{256,512}.png        # Padded square (npm, GitHub avatar)
├── generate-pngs.js          # Script to regenerate PNGs from SVG
├── ink-example.tsx            # Demo showing all Ink variants
└── README.md
```

Ink TUI components live in `src/tui/components/`:
- `Logo.tsx` — React components for Ink CLI framework
- `logo-data.ts` — Raw pixel data (reusable for any renderer)

## Ink Usage

```tsx
import { Logo, LogoHeader, LogoSplash, LogoSmall } from "./components/Logo.js";

<LogoSplash version="1.0.0" />  // Full splash (startup screen)
<LogoHeader version="1.0.0" />  // Header bar (top of TUI)
<Logo />                         // Just the octopus
<LogoSmall />                    // Compact 4-line icon
<Logo double={false} />          // Narrow terminals
```

## Color Palette

| Name  | Hex       | Usage                      |
|-------|-----------|----------------------------|
| Light | `#60a5fa` | Head crown, tentacle tips  |
| Mid   | `#3b82f6` | Body fill                  |
| Dark  | `#2563eb` | Shadow band, tentacle mids |
| Eye   | `#e0f2fe` | Eye highlights             |

## Regenerating PNGs

```bash
npm install sharp
node static/img/logo/generate-pngs.js
```

Uses `sharp.kernel.nearest` to preserve pixel-perfect edges at all sizes.
