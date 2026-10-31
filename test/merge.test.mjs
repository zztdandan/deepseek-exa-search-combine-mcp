import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeSearchResults, normalizeUrl } from '../src/merge.mjs';

const exaResult = (over = {}) => ({
  title: 'Exa title',
  url: 'https://example.com/a',
  published: '2026-01-01T00:00:00.000Z',
  author: 'Ada',
  site: '',
  snippet: 'exa snippet',
  summary: '',
  text: '',
  sources: [],
  ...over,
});

const dsResult = (over = {}) => ({
  title: 'DeepSeek title',
  url: 'https://example.com/a',
  published: '2026-01-02T00:00:00.000Z',
  author: '',
  site: 'Example',
  snippet: 'ds snippet',
  summary: '',
  text: '',
  authority: 3,
  score: 2.1,
  ...over,
});

test('normalizeUrl strips tracking params, hash and trailing slash', () => {
  assert.equal(
    normalizeUrl('https://Example.COM//path/?utm_source=x&utm_medium=y&ref=hn&id=7#frag'),
    'https://example.com/path?id=7',
  );
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
});

test('normalizeUrl keeps meaningful query params', () => {
  assert.equal(normalizeUrl('https://a.com/x?page=2'), 'https://a.com/x?page=2');
});

test('normalizeUrl is defensive about junk', () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(null), '');
  assert.equal(normalizeUrl('not a url'), 'not a url');
});

test('the same page from both providers collapses into one entry', () => {
  const { results, stats } = mergeSearchResults([
    { provider: 'exa', results: [exaResult()] },
    { provider: 'deepseek', results: [dsResult()] },
  ]);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0].sources, ['exa', 'deepseek']);
  assert.equal(results[0].shared, true);
  assert.equal(stats.raw, 2);
  assert.equal(stats.unique, 1);
  assert.equal(stats.shared, 1);
  assert.deepEqual(stats.byProvider, { exa: 1, deepseek: 1 });
});

test('merging fills gaps instead of discarding the second provider', () => {
  const { results } = mergeSearchResults([
    { provider: 'exa', results: [exaResult({ author: '', published: '' })] },
    { provider: 'deepseek', results: [dsResult({ author: '', published: '2026-03-03T00:00:00.000Z' })] },
  ]);

  assert.equal(results[0].published, '2026-03-03T00:00:00.000Z');
  assert.equal(results[0].site, 'Example');
  assert.equal(results[0].authority, 3);
});

test('both providers keep their own snippet', () => {
  const { results } = mergeSearchResults([
    { provider: 'exa', results: [exaResult()] },
    { provider: 'deepseek', results: [dsResult()] },
  ]);
  assert.equal(results[0].snippets.exa, 'exa snippet');
  assert.equal(results[0].snippets.deepseek, 'ds snippet');
});

test('distinct pages keep insertion order', () => {
  const { results } = mergeSearchResults([
    { provider: 'exa', results: [exaResult({ url: 'https://a.com/1' }), exaResult({ url: 'https://a.com/2' })] },
    { provider: 'deepseek', results: [dsResult({ url: 'https://b.com/3' })] },
  ]);
  assert.deepEqual(
    results.map((r) => r.url),
    ['https://a.com/1', 'https://a.com/2', 'https://b.com/3'],
  );
  assert.equal(results[2].shared, false);
});

test('dedupe can be turned off', () => {
  const { results, stats } = mergeSearchResults(
    [
      { provider: 'exa', results: [exaResult()] },
      { provider: 'deepseek', results: [dsResult()] },
    ],
    { dedupe: false },
  );
  assert.equal(results.length, 2);
  assert.equal(stats.dedupeApplied, false);
});

test('URL variants of the same page still collapse', () => {
  const { results } = mergeSearchResults([
    { provider: 'exa', results: [exaResult({ url: 'https://example.com/post' })] },
    { provider: 'deepseek', results: [dsResult({ url: 'https://EXAMPLE.com/post/?utm_campaign=z' })] },
  ]);
  assert.equal(results.length, 1);
});

test('empty batches are handled', () => {
  const { results, stats } = mergeSearchResults([
    { provider: 'exa', results: [] },
    { provider: 'deepseek', results: [] },
  ]);
  assert.deepEqual(results, []);
  assert.equal(stats.unique, 0);
});
