import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.mjs';
import { exaProvider } from '../src/providers/exa.mjs';
import { deepseekProvider } from '../src/providers/deepseek.mjs';
import { HttpError } from '../src/http.mjs';
import { ENV, makeFetch, exaPayload, dsPayload, isExaSearch, isDsSearch, jsonResponse } from './helpers.mjs';

test('exa: sends the documented request shape', async () => {
  const fetchImpl = makeFetch([
    { match: isExaSearch, respond: () => exaPayload([]) },
  ]);

  await exaProvider.search({
    config: loadConfig(ENV.exaOnly),
    query: 'hello',
    count: 5,
    needContent: false,
    fetchImpl,
  });

  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://api.exa.ai/search');
  assert.equal(call.headers['x-api-key'], 'exa-test-key');
  assert.equal(call.body.query, 'hello');
  assert.equal(call.body.numResults, 5);
  assert.equal(call.body.type, 'auto');
  assert.deepEqual(call.body.contents, { highlights: true });
});

test('exa: need_content switches to text extraction', async () => {
  const fetchImpl = makeFetch([{ match: isExaSearch, respond: () => exaPayload([]) }]);
  await exaProvider.search({
    config: loadConfig(ENV.exaOnly),
    query: 'q',
    needContent: true,
    maxChars: 1234,
    fetchImpl,
  });
  assert.deepEqual(fetchImpl.calls[0].body.contents, { highlights: true, text: { maxCharacters: 1234 } });
});

test('exa: clamps numResults to the public ceiling', async () => {
  const fetchImpl = makeFetch([{ match: isExaSearch, respond: () => exaPayload([]) }]);
  await exaProvider.search({ config: loadConfig(ENV.exaOnly), query: 'q', count: 5000, fetchImpl });
  assert.equal(fetchImpl.calls[0].body.numResults, 100);
});

test('exa: forwards domain and date filters only when provided', async () => {
  const fetchImpl = makeFetch([{ match: isExaSearch, respond: () => exaPayload([]) }]);
  await exaProvider.search({
    config: loadConfig(ENV.exaOnly),
    query: 'q',
    includeDomains: ['arxiv.org'],
    category: 'publication',
    fetchImpl,
  });
  const { body } = fetchImpl.calls[0];
  assert.deepEqual(body.includeDomains, ['arxiv.org']);
  assert.equal(body.category, 'publication');
  assert.equal('excludeDomains' in body, false);
  assert.equal('startPublishedDate' in body, false);
});

test('exa: maps provider fields into the shared shape', async () => {
  const fetchImpl = makeFetch([
    {
      match: isExaSearch,
      respond: () =>
        exaPayload([
          {
            title: 'T',
            url: 'https://example.com/x',
            publishedDate: '2026-01-01T00:00:00.000Z',
            author: 'Ada',
            highlights: ['one', 'two'],
            highlightScores: [0.91, 0.5],
          },
        ]),
    },
  ]);

  const { results, meta } = await exaProvider.search({
    config: loadConfig(ENV.exaOnly),
    query: 'q',
    fetchImpl,
  });

  assert.equal(results[0].title, 'T');
  assert.equal(results[0].snippet, 'one … two');
  assert.equal(results[0].score, 0.91);
  assert.equal(meta.cost, 0.007);
});

test('deepseek: sends the documented request shape', async () => {
  const fetchImpl = makeFetch([{ match: isDsSearch, respond: () => dsPayload([]) }]);
  await deepseekProvider.search({
    config: loadConfig(ENV.dsOnly),
    query: 'q',
    count: 4,
    needContent: true,
    oriQuestion: 'why',
    fetchImpl,
  });

  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(call.headers.authorization, 'Bearer ds-test-key');
  assert.deepEqual(call.body, { query: 'q', count: 4, need_content: true, ori_question: 'why' });
});

test('deepseek: clamps count to 50', async () => {
  const fetchImpl = makeFetch([{ match: isDsSearch, respond: () => dsPayload([]) }]);
  await deepseekProvider.search({ config: loadConfig(ENV.dsOnly), query: 'q', count: 900, fetchImpl });
  assert.equal(fetchImpl.calls[0].body.count, 50);
});

test('deepseek: maps rerank score, site and authority', async () => {
  const fetchImpl = makeFetch([
    {
      match: isDsSearch,
      respond: () =>
        dsPayload([
          {
            title: 'DS',
            url: 'https://example.com/ds',
            date: '2026-02-02T00:00:00+00:00',
            site_name: 'Example',
            snippet: 'snip',
            rerank_score: 2.4,
            authority: 4,
          },
        ]),
    },
  ]);

  const { results } = await deepseekProvider.search({
    config: loadConfig(ENV.dsOnly),
    query: 'q',
    fetchImpl,
  });

  assert.equal(results[0].site, 'Example');
  assert.equal(results[0].score, 2.4);
  assert.equal(results[0].authority, 4);
  assert.equal(results[0].published, '2026-02-02T00:00:00+00:00');
});

test('http: non-2xx becomes a retryable HttpError', async () => {
  const fetchImpl = makeFetch([
    { match: isDsSearch, respond: () => jsonResponse({ error: { message: 'slow down', code: 'rate_limit' } }, 429) },
  ]);

  await assert.rejects(
    () => deepseekProvider.search({ config: loadConfig(ENV.dsOnly), query: 'q', fetchImpl }),
    (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 429);
      assert.equal(err.retryable, true);
      assert.match(err.message, /slow down/);
      return true;
    },
  );
});

test('http: 401 is not retryable', async () => {
  const fetchImpl = makeFetch([
    { match: isExaSearch, respond: () => jsonResponse({ error: 'invalid api key' }, 401) },
  ]);

  await assert.rejects(
    () => exaProvider.search({ config: loadConfig(ENV.exaOnly), query: 'q', fetchImpl }),
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.retryable, false);
      assert.match(err.message, /invalid api key/);
      return true;
    },
  );
});

test('http: non-JSON 2xx response is rejected', async () => {
  const fetchImpl = makeFetch([
    { match: isExaSearch, respond: () => new Response('<html>oops</html>', { status: 200 }) },
  ]);

  await assert.rejects(
    () => exaProvider.search({ config: loadConfig(ENV.exaOnly), query: 'q', fetchImpl }),
    /non-JSON/,
  );
});

test('http: abort surfaces as a timeout error', async () => {
  const fetchImpl = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };

  await assert.rejects(
    () => exaProvider.search({ config: loadConfig(ENV.exaOnly), query: 'q', fetchImpl }),
    (err) => {
      assert.equal(err.code, 'timeout');
      assert.equal(err.retryable, true);
      return true;
    },
  );
});
