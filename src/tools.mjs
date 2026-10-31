/**
 * Tool definitions and the tool-call implementations.
 *
 * Tool schemas live next to the code that consumes them so a change to one
 * side cannot drift from the other.
 */

import { resolveProviders, resolveFetchOrder, describeConfig } from './config.mjs';
import { fanOutSearch, orderedFetch } from './providers/index.mjs';
import { mergeSearchResults } from './merge.mjs';
import { renderSearch, renderFetch } from './render.mjs';

const PROVIDER_ENUM = ['both', 'exa', 'deepseek'];

export const TOOL_DEFINITIONS = [
  {
    name: 'search',
    title: 'Combined web search',
    description:
      'Search the web through DeepSeek and Exa at once and get back a single deduplicated list. ' +
      'By default every configured provider is queried in parallel and pages found by both are merged ' +
      'into one entry (labelled with all sources). Pass provider="exa" or "deepseek" to use just one. ' +
      'If only one API key is configured, the default automatically narrows to that provider.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query. DeepSeek supports operators: site:, -site:, "exact phrase", -word, lang:zh,en, after:2025, before:2026-06-01.',
        },
        provider: {
          type: 'string',
          enum: PROVIDER_ENUM,
          description:
            'Which backend(s) to query. Omit or "both" to use every configured provider; "exa" / "deepseek" to force one.',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Results per provider (Exa caps at 100, DeepSeek at 50). Default 8.',
        },
        need_content: {
          type: 'boolean',
          description: 'Also fetch page body text for each hit. Much larger responses and higher cost.',
        },
        max_chars: {
          type: 'integer',
          minimum: 200,
          maximum: 20000,
          description: 'Per-page text cap when need_content is true. Default 4000.',
        },
        include_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exa only. Restrict results to these domains or domain paths.',
        },
        exclude_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exa only. Exclude these domains or domain paths.',
        },
        start_published_date: {
          type: 'string',
          description: 'Exa only. ISO 8601 lower bound, e.g. 2025-01-01T00:00:00.000Z',
        },
        end_published_date: {
          type: 'string',
          description: 'Exa only. ISO 8601 upper bound.',
        },
        category: {
          type: 'string',
          enum: ['company', 'publication', 'news', 'personal site', 'financial report', 'people'],
          description: 'Exa only. Focus the index on one data category.',
        },
        type: {
          type: 'string',
          description: 'Exa only search mode: auto (default), lite, deep-lite, deep, instant, fast.',
        },
        ori_question: {
          type: 'string',
          description: 'DeepSeek only. The original user question, improves query understanding (max 128 chars).',
        },
        localization: {
          type: 'string',
          description: 'DeepSeek only. IP address used to localize results.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch',
    title: 'Combined page fetch',
    description:
      'Fetch full page content for one or more URLs. Providers are tried in the configured fallback order ' +
      '(Exa first by default, then DeepSeek) and the first one that returns real content wins per URL. ' +
      'Pass provider="exa" or "deepseek" to pin a single backend.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'A single URL to fetch.' },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Several URLs at once. Exa handles the batch in one request.',
        },
        provider: {
          type: 'string',
          enum: PROVIDER_ENUM,
          description:
            'Omit or "both" for the configured fallback order; "exa" / "deepseek" to pin one backend.',
        },
        max_chars: {
          type: 'integer',
          minimum: 200,
          maximum: 20000,
          description: 'Per-page output cap. Default 6000.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'status',
    title: 'Server status',
    description:
      'Report which backends this server can reach, the default search behaviour and the fetch fallback order. ' +
      'Makes no network calls and costs nothing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function collectUrls(args) {
  const list = [];
  if (args.url) list.push(String(args.url).trim());
  if (Array.isArray(args.urls)) for (const u of args.urls) if (u) list.push(String(u).trim());
  return [...new Set(list.filter(Boolean))];
}

async function runSearchTool(args, ctx) {
  const { config } = ctx;
  const query = String(args.query || '').trim();
  if (!query) throw Object.assign(new Error('query is required'), { code: 'invalid_arguments' });

  const { providers, notes } = resolveProviders(args.provider, config);
  const count = clamp(args.count, 1, 100, 8);
  const needContent = Boolean(args.need_content);
  const maxChars = clamp(args.max_chars, 200, 20000, 4000);

  const batches = await fanOutSearch(providers, {
    config,
    query,
    count,
    needContent,
    maxChars,
    includeDomains: Array.isArray(args.include_domains) ? args.include_domains : undefined,
    excludeDomains: Array.isArray(args.exclude_domains) ? args.exclude_domains : undefined,
    startPublishedDate: args.start_published_date,
    endPublishedDate: args.end_published_date,
    category: args.category,
    type: args.type,
    oriQuestion: args.ori_question,
    localization: args.localization,
    fetchImpl: ctx.fetchImpl,
  });

  const okBatches = batches.filter((b) => b.ok).map((b) => ({ provider: b.provider, results: b.results }));
  const failures = batches.filter((b) => !b.ok);
  const { results, stats } = mergeSearchResults(okBatches, { dedupe: config.dedupe });

  const text = renderSearch({
    query,
    results,
    stats,
    providers: batches.filter((b) => b.ok).map((b) => b.provider),
    failures,
    notes,
    includeText: needContent,
  });

  return {
    text,
    isError: batches.every((b) => !b.ok),
    structured: {
      query,
      providers,
      stats,
      failures: failures.map((f) => ({ provider: f.provider, ...f.error })),
      results,
    },
  };
}

async function runFetchTool(args, ctx) {
  const { config } = ctx;
  const urls = collectUrls(args);
  if (!urls.length) throw Object.assign(new Error('url or urls is required'), { code: 'invalid_arguments' });

  const order = resolveFetchOrder(args.provider, config);
  const maxChars = clamp(args.max_chars, 200, 20000, 6000);

  const { pages, attempts } = await orderedFetch(order, {
    config,
    urls,
    maxChars,
    fetchImpl: ctx.fetchImpl,
  });

  return {
    text: renderFetch({ pages, attempts, order }),
    isError: pages.length === 0,
    structured: { order, pages, attempts },
  };
}

function runStatusTool(_args, ctx) {
  const { config } = ctx;
  const info = describeConfig(config);
  const lines = [
    'deepseek-exa-search-combine · status',
    info.providers,
    `default search : ${info.defaultSearchProvider}${config.availableProviders.length === 1 ? ` (narrowed to ${config.availableProviders[0]})` : ''}`,
    `fetch order    : ${info.effectiveFetchOrder.join(' → ') || 'none'}`,
    `dedupe         : ${info.dedupe}`,
    `timeout        : ${info.timeoutMs}ms`,
    `tools          : ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}`,
  ];
  return {
    text: lines.join('\n'),
    isError: false,
    structured: { ...info, availableProviders: [...config.availableProviders] },
  };
}

/**
 * @param {string} name
 * @param {object} args
 * @param {{config: object, fetchImpl?: typeof fetch}} ctx
 */
export async function callTool(name, args, ctx) {
  const safeArgs = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'search':
      return runSearchTool(safeArgs, ctx);
    case 'fetch':
      return runFetchTool(safeArgs, ctx);
    case 'status':
      return runStatusTool(safeArgs, ctx);
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'unknown_tool' });
  }
}
