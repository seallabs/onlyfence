/** Check if the current process is running as root (UID 0). */
export function isRunningAsRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}
