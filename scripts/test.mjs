#!/usr/bin/env node
/**
 * Cross-runtime test launcher.
 *
 * `node --test "test/*.test.mjs"` only expands globs from Node 21 onward; on
 * Node 20 the pattern is taken literally and the run fails. Collecting the
 * files here keeps `npm test` identical on Node 20, 22 and 24, and on both
 * Windows and Linux.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const live = process.argv.includes('--live');
const dir = join(root, 'test', live ? 'live' : '');

function collect(directory) {
  let files = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) files = files.concat(collect(full));
    else if (entry.endsWith('.test.mjs')) files.push(full);
  }
  return files;
}

let files;
try {
  files = collect(dir);
} catch {
  process.stderr.write(`No tests found in ${dir}\n`);
  process.exit(1);
}

if (!files.length) {
  process.stderr.write(`No *.test.mjs files in ${dir}\n`);
  process.exit(1);
}

process.stdout.write(`${live ? 'live' : 'unit'} tests: ${files.length} file(s)\n`);

try {
  execFileSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
} catch (err) {
  process.exit(err.status ?? 1);
}
