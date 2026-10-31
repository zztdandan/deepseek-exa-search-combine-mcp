/**
 * Command line entry points.
 *
 * `dxsc` with no arguments behaves as an MCP stdio server, so a client can
 * point at the binary directly. The remaining subcommands exist so a human can
 * verify the same code path without wiring up an MCP client first.
 */

import { loadConfig, ConfigError, describeConfig } from './config.mjs';
import { createDispatcher, SERVER_NAME, SERVER_VERSION, SERVER_INSTRUCTIONS } from './server.mjs';
import { serveStdio } from './transports/stdio.mjs';
import { callTool, TOOL_DEFINITIONS } from './tools.mjs';

const USAGE = `deepseek-exa-search-combine-mcp v${SERVER_VERSION}

Usage:
  dxsc                          run as an MCP stdio server (same as: dxsc serve)
  dxsc serve                    run as an MCP stdio server
  dxsc search <query> [opts]    run a combined search from the terminal
  dxsc fetch <url...> [opts]    fetch page content from the terminal
  dxsc status                   show configuration and availability
  dxsc --version | --help

Search options:
  --provider <both|exa|deepseek>   default: both (every configured provider)
  --count <n>                      results per provider (default 8)
  --content                        also return page text
  --max-chars <n>                  per-page text cap (default 4000)
  --domain <d>                     Exa: only these domains (repeatable)
  --exclude-domain <d>             Exa: skip these domains (repeatable)
  --after <iso8601>                Exa: published after
  --before <iso8601>               Exa: published before
  --category <c>                   Exa: company|publication|news|personal site|financial report|people
  --json                           print structured JSON instead of Markdown

Fetch options:
  --provider <both|exa|deepseek>   default: configured fallback order (Exa first)
  --max-chars <n>                  per-page cap (default 6000)
  --json                           print structured JSON instead of Markdown

Environment:
  EXA_API_KEY            Exa API key
  DEEPSEEK_API_KEY       DeepSeek API key
  DEFAULT_SEARCH_PROVIDER  both (default) | exa | deepseek
  FETCH_PROVIDER_ORDER     default "exa,deepseek"
  SEARCH_HTTP_TIMEOUT_MS   default 60000
  EXA_BASE_URL / DEEPSEEK_BASE_URL
  MERGE_DEDUPE             set to "false" to disable cross-provider dedupe
`;

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    if (flags[key] === undefined) flags[key] = next;
    else if (Array.isArray(flags[key])) flags[key].push(next);
    else flags[key] = [flags[key], next];
    i += 1;
  }
  return { positional, flags };
}

function asList(value) {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function fail(message, hint) {
  process.stderr.write(`error: ${message}\n`);
  if (hint) process.stderr.write(`hint: ${hint}\n`);
  process.exitCode = 1;
}

function loadOrExit() {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      fail(err.message, err.hint);
      return null;
    }
    throw err;
  }
}

async function runSearch(argv) {
  const { positional, flags } = parseFlags(argv);
  const query = positional.join(' ').trim();
  if (!query) return fail('search needs a query', 'dxsc search "your query"');

  const config = loadOrExit();
  if (!config) return;

  let outcome;
  try {
    outcome = await callTool(
      'search',
      {
        query,
        provider: flags.provider,
        count: flags.count !== undefined ? Number(flags.count) : undefined,
        need_content: Boolean(flags.content),
        max_chars: flags['max-chars'] !== undefined ? Number(flags['max-chars']) : undefined,
        include_domains: asList(flags.domain),
        exclude_domains: asList(flags['exclude-domain']),
        start_published_date: flags.after,
        end_published_date: flags.before,
        category: flags.category,
      },
      { config },
    );
  } catch (err) {
    return fail(err?.message || String(err), err?.hint);
  }

  if (flags.json) process.stdout.write(`${JSON.stringify(outcome.structured, null, 2)}\n`);
  else process.stdout.write(`${outcome.text}\n`);
  if (outcome.isError) process.exitCode = 1;
}

async function runFetch(argv) {
  const { positional, flags } = parseFlags(argv);
  if (!positional.length) return fail('fetch needs at least one URL', 'dxsc fetch https://example.com');

  const config = loadOrExit();
  if (!config) return;

  let outcome;
  try {
    outcome = await callTool(
      'fetch',
      {
        urls: positional,
        provider: flags.provider,
        max_chars: flags['max-chars'] !== undefined ? Number(flags['max-chars']) : undefined,
      },
      { config },
    );
  } catch (err) {
    return fail(err?.message || String(err), err?.hint);
  }

  if (flags.json) process.stdout.write(`${JSON.stringify(outcome.structured, null, 2)}\n`);
  else process.stdout.write(`${outcome.text}\n`);
  if (outcome.isError) process.exitCode = 1;
}

function runStatus() {
  const config = loadOrExit();
  if (!config) return;
  const info = describeConfig(config);
  process.stdout.write(`\n${SERVER_NAME} v${SERVER_VERSION}\n\n`);
  process.stdout.write(`  ${info.providers}\n`);
  process.stdout.write(`  default search : ${info.defaultSearchProvider}\n`);
  process.stdout.write(`  fetch order    : ${info.effectiveFetchOrder.join(' → ') || 'none'}\n`);
  process.stdout.write(`  dedupe         : ${info.dedupe}\n`);
  process.stdout.write(`  timeout        : ${info.timeoutMs}ms\n`);
  process.stdout.write(`  tools          : ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}\n\n`);
  if (config.availableProviders.length === 1) {
    process.stdout.write(
      `  note: only ${config.availableProviders[0]} is configured; "both" narrows to it automatically.\n\n`,
    );
  }
}

async function runServe() {
  const config = loadOrExit();
  if (!config) return;

  const dispatch = createDispatcher({
    config,
    log: (msg) => process.stderr.write(`[${SERVER_NAME}] ${msg}\n`),
  });

  process.stderr.write(
    `[${SERVER_NAME}] v${SERVER_VERSION} ready · providers: ${config.availableProviders.join(', ')}` +
      ` · fetch order: ${config.fetchProviderOrder.join(' → ')}\n`,
  );

  await serveStdio({
    dispatch,
    log: (msg) => process.stderr.write(`[${SERVER_NAME}] ${msg}\n`),
  });
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case 'serve':
      return runServe();
    case 'search':
      return runSearch(rest);
    case 'fetch':
      return runFetch(rest);
    case 'status':
    case 'doctor':
      return runStatus();
    case '--version':
    case '-v':
    case 'version':
      process.stdout.write(`${SERVER_VERSION}\n`);
      return;
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(USAGE);
      return;
    case '--instructions':
      process.stdout.write(`${SERVER_INSTRUCTIONS}\n`);
      return;
    default:
      return fail(`unknown command "${command}"`, 'run `dxsc --help`');
  }
}
