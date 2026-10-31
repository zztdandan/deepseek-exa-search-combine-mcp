import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderSearch, renderFetch, cleanSnippet } from '../src/render.mjs';

const baseStats = (over = {}) => ({ raw: 1, unique: 1, shared: 0, dedupeApplied: true, byProvider: {}, ...over });

const result = (over = {}) => ({
  title: 'Title',
  url: 'https://example.com/a',
  published: '2026-01-01T00:00:00.000Z',
  author: '',
  site: '',
  snippet: 'A snippet',
  summary: '',
  text: '',
  sources: ['exa'],
  snippets: { exa: 'A snippet' },
  shared: false,
  ...over,
});

test('renderSearch: empty result set says so plainly', () => {
  const text = renderSearch({ query: 'q', results: [], stats: baseStats({ raw: 0, unique: 0 }), providers: ['exa'] });
  assert.match(text, /No results\./);
});

test('renderSearch: header summarises the merge', () => {
  const text = renderSearch({
    query: 'rust async',
    results: [result()],
    stats: baseStats({ raw: 2, unique: 1, shared: 1 }),
    providers: ['exa', 'deepseek'],
  });
  assert.match(text, /Search "rust async"/);
  assert.match(text, /providers: exa \+ deepseek/);
  assert.match(text, /1 unique of 2 raw/);
  assert.match(text, /1 in both/);
});

test('renderSearch: numbers results and shows sources', () => {
  const text = renderSearch({
    query: 'q',
    results: [result({ sources: ['exa', 'deepseek'], shared: true, snippets: { exa: 'A snippet', deepseek: 'Other take' } })],
    stats: baseStats(),
    providers: ['exa', 'deepseek'],
  });
  assert.match(text, /1\. Title/);
  assert.match(text, /https:\/\/example\.com\/a/);
  assert.match(text, /exa · deepseek/);
  assert.match(text, /deepseek: Other take/);
});

test('renderSearch: failures become notes', () => {
  const text = renderSearch({
    query: 'q',
    results: [result()],
    stats: baseStats(),
    providers: ['exa'],
    failures: [{ provider: 'deepseek', error: { message: 'HTTP 429', retryable: true } }],
  });
  assert.match(text, /Notes:/);
  assert.match(text, /deepseek failed: HTTP 429 \(retryable\)/);
});

test('renderSearch: notes from single-provider narrowing are preserved', () => {
  const text = renderSearch({
    query: 'q',
    results: [result()],
    stats: baseStats(),
    providers: ['exa'],
    notes: ['Only exa is configured'],
  });
  assert.match(text, /Only exa is configured/);
});

test('renderSearch: includeText appends page content', () => {
  const text = renderSearch({
    query: 'q',
    results: [result({ text: 'line one\nline two' })],
    stats: baseStats(),
    providers: ['exa'],
    includeText: true,
  });
  assert.match(text, /── content ──/);
  assert.match(text, /line one/);
});

test('renderFetch: shows each page with its provider', () => {
  const text = renderFetch({
    pages: [{ url: 'https://example.com/a', title: 'Doc', text: 'body text', provider: 'exa' }],
    attempts: [],
    order: ['exa', 'deepseek'],
  });
  assert.match(text, /1 ok, 0 failed/);
  assert.match(text, /order: exa → deepseek/);
  assert.match(text, /1\. Doc/);
  assert.match(text, /exa/);
  assert.match(text, /body text/);
});

test('renderFetch: lists failures', () => {
  const text = renderFetch({
    pages: [],
    attempts: [{ url: 'https://bad.example', provider: 'exa', error: 'HTTP 404' }],
    order: ['exa'],
  });
  assert.match(text, /Failed:/);
  assert.match(text, /https:\/\/bad\.example \(exa\): HTTP 404/);
});

test('cleanSnippet folds newlines so the list layout survives', () => {
  assert.equal(cleanSnippet('# Heading\n\nSome   text\nhere'), 'Heading Some text here');
});

test('cleanSnippet strips html tags', () => {
  assert.equal(cleanSnippet('<p>Hello <b>world</b></p>'), 'Hello world');
});

test('cleanSnippet cuts scraped JSX down to the readable prefix', () => {
  const cleaned = cleanSnippet(
    'The protocol has parts. `\\n`,_jsx(_components.p,{children:`more text`}) ...',
  );
  assert.equal(cleaned.includes('_jsx('), false);
  assert.match(cleaned, /^The protocol has parts\./);
});

test('cleanSnippet drops a snippet that is pure code', () => {
  assert.equal(cleanSnippet('` `,_jsx(_components.p,{children:`x`})'), '');
});

test('cleanSnippet strips a leading markdown heading marker', () => {
  assert.equal(cleanSnippet('# Specification Some text'), 'Specification Some text');
});

test('renderSearch: falls back to the URL when a provider gives no title', () => {
  const text = renderSearch({
    query: 'q',
    results: [result({ title: '', url: 'https://modelcontextprotocol.io/specification/2026-07-28' })],
    stats: baseStats(),
    providers: ['exa'],
  });
  assert.match(text, /1\. modelcontextprotocol\.io\/specification\/2026-07-28/);
  assert.equal(text.includes('(untitled)'), false);
});

test('renderSearch: multi-line body keeps its line breaks', () => {
  const text = renderSearch({
    query: 'q',
    results: [result({ text: 'first line\nsecond line' })],
    stats: baseStats(),
    providers: ['exa'],
    includeText: true,
  });
  assert.match(text, /first line\n\s+second line/);
});
