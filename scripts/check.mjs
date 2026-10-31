#!/usr/bin/env node
/**
 * Cross-platform syntax check.
 *
 * `node --check src/*.mjs` relies on the shell expanding the glob, which cmd.exe
 * does not do. Walking the tree here keeps `npm run check` identical on Windows
 * and Linux.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(full, out);
    } else if (entry.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(join(root, 'src')).concat(walk(join(root, 'bin')), walk(join(root, 'scripts')), walk(join(root, 'test')));

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    process.stdout.write(`  ok  ${relative(root, file)}\n`);
  } catch (err) {
    failed += 1;
    process.stdout.write(` FAIL ${relative(root, file)}\n`);
    process.stdout.write(`${err.stderr || err.message}\n`);
  }
}

process.stdout.write(`\n${files.length - failed}/${files.length} files parsed\n`);
process.exit(failed ? 1 : 0);
