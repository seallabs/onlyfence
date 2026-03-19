/**
 * OnlyFence TUI color palette.
 *
 * Three blue tones with light-blue accent:
 * - highlight: bright blue for active elements
 * - body: medium blue for labels and borders
 * - shadow: dark blue for panel borders
 * - eyes: very light blue for primary text
 */
export const theme = {
  highlight: '#60a5fa',
  body: '#3b82f6',
  shadow: '#2563eb',
  eyes: '#e0f2fe',
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  muted: '#64748b',
  panelBorder: '#475569',
} as const;

/** Map a policy decision string to a theme color. */
export function policyDecisionColor(decision: string): string {
  switch (decision) {
    case 'approved':
      return theme.success;
    case 'rejected':
      return theme.error;
    default:
      return theme.warning;
  }
}
