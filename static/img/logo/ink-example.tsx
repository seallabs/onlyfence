/**
 * Example: render each logo variant.
 *
 * Run with:
 *   npx tsx example.tsx
 *
 * Requires: ink, react, and the Logo component in the same directory.
 */
import React from "react";
import { render, Box, Text } from "ink";
import { Logo, LogoHeader, LogoSplash, LogoSmall } from "../../../src/tui/components/Logo.js";

function App() {
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      {/* 1. Splash screen — startup / no-args */}
      <Box borderStyle="single" borderColor="#3b82f6" flexDirection="column" paddingX={2}>
        <Text dimColor>{"<LogoSplash />"}</Text>
        <LogoSplash version="1.0.0" />
      </Box>

      {/* 2. Header bar — top of TUI screens */}
      <Box borderStyle="single" borderColor="#3b82f6" flexDirection="column" paddingX={2}>
        <Text dimColor>{"<LogoHeader />"}</Text>
        <Box paddingY={1}>
          <LogoHeader version="1.0.0" />
        </Box>
      </Box>

      {/* 3. Compact small logo */}
      <Box borderStyle="single" borderColor="#3b82f6" flexDirection="column" paddingX={2}>
        <Text dimColor>{"<LogoSmall />"}</Text>
        <Box paddingY={1}>
          <LogoSmall />
        </Box>
      </Box>

      {/* 4. Standalone single-width (narrow terminals) */}
      <Box borderStyle="single" borderColor="#3b82f6" flexDirection="column" paddingX={2}>
        <Text dimColor>{'<Logo double={false} />'}</Text>
        <Box paddingY={1}>
          <Logo double={false} />
        </Box>
      </Box>
    </Box>
  );
}

render(<App />);
