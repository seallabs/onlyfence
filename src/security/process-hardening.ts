/**
 * Optional process hardening via OS-level protections.
 *
 * These are best-effort mitigations that reduce the attack surface for
 * same-user memory reads. They never throw — failure is logged and the
 * process continues without the protection.
 *
 * - Linux: PR_SET_DUMPABLE=0 prevents ptrace and /proc/pid/mem reads
 * - macOS: PT_DENY_ATTACH prevents debugger attachment
 *
 * The syscall must execute inside the Node.js process itself. We compile
 * a shared library whose constructor calls the OS primitive, then
 * dlopen() it so the constructor runs in our address space. The dlopen
 * throws "Module did not self-register" (not a N-API addon) but the
 * constructor has already executed by then.
 */

import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

const LINUX_SOURCE = `
#include <sys/prctl.h>
__attribute__((constructor))
static void set_nondumpable(void) { prctl(4, 0, 0, 0, 0); }
`;

const DARWIN_SOURCE = `
#include <sys/types.h>
#include <sys/ptrace.h>
__attribute__((constructor))
static void deny_attach(void) { ptrace(31, 0, 0, 0); }
`;

/**
 * Compile a C source string into a shared library, dlopen it so the
 * constructor runs in this process, then clean up the temp files.
 */
function compileAndLoad(cSource: string, libExtension: string): boolean {
  const base = join(tmpdir(), `.fence_hardening_${process.pid}`);
  const src = `${base}.c`;
  const lib = `${base}.${libExtension}`;

  try {
    writeFileSync(src, cSource);
    execFileSync('cc', ['-shared', '-fPIC', '-o', lib, src]);
    // Constructor runs during dlopen, applying the syscall to THIS process.
    // dlopen throws because it's not a N-API module — that's expected.
    try {
      process.dlopen({ exports: {} } as NodeJS.Module, lib);
    } catch {
      /* expected */
    }
    return true;
  } catch {
    return false;
  } finally {
    tryUnlink(src);
    tryUnlink(lib);
  }
}

/**
 * Attempt to set PR_SET_DUMPABLE=0 on Linux to prevent memory dumps.
 */
export function trySetNondumpable(): boolean {
  if (platform() !== 'linux') return false;
  return compileAndLoad(LINUX_SOURCE, 'so');
}

/**
 * Attempt to set PT_DENY_ATTACH on macOS to prevent debugger attachment.
 */
export function tryDenyAttach(): boolean {
  if (platform() !== 'darwin') return false;
  return compileAndLoad(DARWIN_SOURCE, 'dylib');
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* best-effort */
  }
}
