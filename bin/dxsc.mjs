#!/usr/bin/env node
/**
 * deepseek-exa-search-combine-mcp
 *
 * With no arguments this process is an MCP server speaking JSON-RPC over
 * stdio. Everything else is a human-facing command -- see `dxsc --help`.
 */

import { main } from '../src/cli.mjs';

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});
