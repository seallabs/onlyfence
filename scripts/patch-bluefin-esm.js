/**
 * Patch: @bluefin-exchange/bluefin7k-aggregator-sdk ESM fix
 *
 * The package ships an ESM entry (lib/esm/index.mjs) that imports from
 * ./config/index.js — a .js file. Without "type": "module" in the esm
 * directory, Node treats .js as CJS and refuses the named `Config` export.
 *
 * This script adds a minimal package.json to lib/esm/ so Node resolves
 * all .js files under it as ESM.
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(
  root,
  'node_modules',
  '@bluefin-exchange',
  'bluefin7k-aggregator-sdk',
  'lib',
  'esm',
  'package.json',
);

if (!existsSync(dirname(target))) {
  // Package not installed (optional dep, CI prune, etc.)
  process.exit(0);
}

if (!existsSync(target)) {
  writeFileSync(target, '{ "type": "module" }\n');
}
