import type { Command } from 'commander';
import type { CliEventLog } from '../db/cli-events.js';
import { hasLogger, getLogger } from '../logger/index.js';

/**
 * Build the full command name for a Commander.js command,
 * including parent names (e.g. "config set", "query price").
 */
function buildCommandName(cmd: Command): string {
  const parts: string[] = [];
  let current: Command | null = cmd;
  while (current !== null) {
    const name = current.name();
    if (name.length > 0 && name !== 'fence') {
      parts.unshift(name);
    }
    current = current.parent;
  }
  return parts.join(' ');
}

/**
 * Register Commander.js pre/post-action hooks that automatically
 * time every command and record the result to cli_events.
 *
 * New commands get timing for free — no per-command changes needed.
 */
export function withTiming(program: Command, getEventLog: () => CliEventLog | undefined): void {
  const startTimes = new WeakMap<Command, number>();

  program.hook('preAction', (thisCommand: Command) => {
    startTimes.set(thisCommand, performance.now());
  });

  program.hook('postAction', (thisCommand: Command) => {
    const start = startTimes.get(thisCommand);
    if (start === undefined) {
      return;
    }
    startTimes.delete(thisCommand);

    const durationMs = Math.round(performance.now() - start);
    const commandName = buildCommandName(thisCommand);
    const success = process.exitCode === undefined || process.exitCode === 0;

    try {
      const eventLog = getEventLog();
      if (eventLog !== undefined) {
        eventLog.recordEvent({
          command: commandName,
          success,
          durationMs,
        });
      }
    } catch (err: unknown) {
      // Log but never let timing recording break a command
      if (hasLogger()) {
        getLogger().warn({ err }, 'Failed to record CLI event');
      }
    }
  });
}
