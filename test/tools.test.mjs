import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.mjs';
import { callTool } from '../src/tools.mjs';
import {
  ENV,
  makeFetch,
  exaPayload,
  dsPayload,
  dsFetchPayload,
  isExaSearch,
  isExaContents,
  isDsSearch,
  isDsFetch,
  jsonResponse,
} from './helpers.mjs';

test('search: both providers, merged and deduplicated', async () => {
  const fetchImpl = makeFetch([
    {
      match: isExaSearch,
      respond: () =>
        exaPayload([
          { title: 'Shared', url: 'https://example.com/shared', highlights: ['from exa'] },
          { title: 'Exa only', url: 'https://example.com/exa', highlights: ['exa only'] },
        ]),
    },
    {
      match: isDsSearch,
      respond: () =>
        dsPayload([
          { title: 'Shared (ds)', url: 'https://example.com/shared/', snippet: 'from deepseek', authority: 3 },
          { title: 'DS only', url: 'https://example.com/ds', snippet: 'ds only' },
        ]),
    },
  ]);

  const outcome = await callTool('search', { query: 'q', count: 2 }, { config: loadConfig(ENV.both), fetchImpl });

  assert.equal(outcome.isError, false);
  assert.equal(outcome.structured.stats.raw, 4);
  assert.equal(outcome.structured.stats.unique, 3);
  assert.equal(outcome.structured.stats.shared, 1);
  assert.deepEqual(
    outcome.structured.results.map((r) => r.sources),
    [['exa', 'deepseek'], ['exa'], ['deepseek']],
  );
  assert.match(outcome.text, /1\. Shared/);
  assert.match(outcome.text, /3 unique of 4 raw/);
});

test('search: one provider failing does not remove the other results', async () => {
  const fetchImpl = makeFetch([
    { match: isExaSearch, respond: () => jsonResponse({ error: 'exa exploded' }, 500) },
    {
      match: isDsSearch,
      respond: () => dsPayload([{ title: 'DS hit', url: 'https://example.com/ds', snippet: 'ok' }]),
    },
  ]);

  const outcome = await callTool('search', { query: 'q' }, { config: loadConfig(ENV.both), fetchImpl });

  assert.equal(outcome.isError, false, 'a partial failure is still a usable answer');
  assert.equal(outcome.structured.results.length, 1);
  assert.equal(outcome.structured.results[0].sources[0], 'deepseek');
  assert.match(outcome.text, /exa failed: exa exploded/);
});

test('search: total failure sets isError', async () => {
  const fetchImpl = makeFetch([
    { match: isExaSearch, respond: () => jsonResponse({ error: 'boom' }, 500) },
    { match: isDsSearch, respond: () => jsonResponse({ error: 'boom' }, 500) },
  ]);

  const outcome = await callTool('search', { query: 'q' }, { config: loadConfig(ENV.both), fetchImpl });

  assert.equal(outcome.isError, true);
  assert.equal(outcome.structured.results.length, 0);
});

test('search: single key means no phantom failure block', async () => {
  const fetchImpl = makeFetch([
    {
      match: isExaSearch,
      respond: () => exaPayload([{ title: 'Only exa', url: 'https://example.com/a', highlights: ['x'] }]),
    },
  ]);

  const outcome = await callTool('search', { query: 'q', provider: 'both' }, { config: loadConfig(ENV.exaOnly), fetchImpl });

  assert.equal(outcome.isError, false);
  assert.equal(outcome.structured.providers.length, 1);
  assert.equal(outcome.structured.failures.length, 0, 'no deepseek call was attempted at all');
  assert.match(outcome.text, /Only exa is configured/);
  assert.equal(fetchImpl.calls.length, 1);
});

test('search: explicit provider with no key is a clear tool error', async () => {
  await assert.rejects(
    () => callTool('search', { query: 'q', provider: 'deepseek' }, { config: loadConfig(ENV.exaOnly) }),
    /Provider "deepseek" is not configured/,
  );
});

test('search: missing query is rejected', async () => {
  await assert.rejects(
    () => callTool('search', { provider: 'exa' }, { config: loadConfig(ENV.exaOnly) }),
    /query is required/,
  );
});

test('fetch: falls back to the next provider when the first returns nothing', async () => {
  const fetchImpl = makeFetch([
    { match: isExaContents, respond: () => jsonResponse({ results: [{ url: 'https://example.com/a', text: '' }] }) },
    { match: isDsFetch, respond: () => dsFetchPayload('DeepSeek title', '# Hello from DeepSeek') },
  ]);

  const outcome = await callTool('fetch', { url: 'https://example.com/a' }, { config: loadConfig(ENV.both), fetchImpl });

  assert.equal(outcome.isError, false);
  assert.equal(outcome.structured.pages.length, 1);
  assert.equal(outcome.structured.pages[0].provider, 'deepseek');
  assert.match(outcome.text, /Hello from DeepSeek/);
});

test('fetch: exa wins when it returns content (default order)', async () => {
  const fetchImpl = makeFetch([
    { match: isExaContents, respond: () => jsonResponse({ results: [{ url: 'https://example.com/a', title: 'E', text: 'exa body' }] }) },
  ]);

  const outcome = await callTool('fetch', { url: 'https://example.com/a' }, { config: loadConfig(ENV.both), fetchImpl });

  assert.equal(outcome.structured.pages[0].provider, 'exa');
  assert.equal(fetchImpl.calls.length, 1, 'deepseek is never called when exa succeeds');
});

test('fetch: order is configurable', async () => {
  const config = loadConfig({ ...ENV.both, FETCH_PROVIDER_ORDER: 'deepseek,exa' });
  const fetchImpl = makeFetch([
    { match: isDsFetch, respond: () => dsFetchPayload('D', 'deepseek body') },
  ]);

  const outcome = await callTool('fetch', { url: 'https://example.com/a' }, { config, fetchImpl });

  assert.equal(outcome.structured.pages[0].provider, 'deepseek');
  assert.deepEqual(outcome.structured.order, ['deepseek', 'exa']);
});

test('fetch: total failure sets isError', async () => {
  const fetchImpl = makeFetch([
    { match: isExaContents, respond: () => jsonResponse({ error: 'nope' }, 500) },
    { match: isDsFetch, respond: () => jsonResponse({ error: 'nope' }, 404) },
  ]);

  const outcome = await callTool('fetch', { url: 'https://example.com/a' }, { config: loadConfig(ENV.both), fetchImpl });

  assert.equal(outcome.isError, true);
  assert.equal(outcome.structured.pages.length, 0);
  assert.match(outcome.text, /Failed:/);
});

test('fetch: requires a URL', async () => {
  await assert.rejects(
    () => callTool('fetch', {}, { config: loadConfig(ENV.both) }),
    /url or urls is required/,
  );
});

test('status: reports configuration without network access', async () => {
  const fetchImpl = makeFetch([]);
  const outcome = await callTool('status', {}, { config: loadConfig(ENV.dsOnly), fetchImpl });

  assert.equal(outcome.isError, false);
  assert.equal(fetchImpl.calls.length, 0);
  assert.match(outcome.text, /exa: missing/);
  assert.match(outcome.text, /deepseek: configured/);
  assert.match(outcome.text, /fetch order {4}: deepseek/);
});
