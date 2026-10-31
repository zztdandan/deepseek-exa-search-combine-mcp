import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadConfig,
  resolveProviders,
  resolveFetchOrder,
  parseProviderOrder,
  parseProviderSelector,
  describeConfig,
  ConfigError,
  ProviderUnavailableError,
} from '../src/config.mjs';
import { ENV } from './helpers.mjs';

test('loadConfig fails fast with no keys', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({}), /EXA_API_KEY or DEEPSEEK_API_KEY/);
});

test('loadConfig accepts a single key', () => {
  const exa = loadConfig(ENV.exaOnly);
  assert.deepEqual([...exa.availableProviders], ['exa']);
  assert.equal(exa.configured.exa, true);
  assert.equal(exa.configured.deepseek, false);

  const ds = loadConfig(ENV.dsOnly);
  assert.deepEqual([...ds.availableProviders], ['deepseek']);
});

test('loadConfig accepts both keys', () => {
  const cfg = loadConfig(ENV.both);
  assert.deepEqual([...cfg.availableProviders], ['exa', 'deepseek']);
});

test('defaults: both for search, exa first for fetch', () => {
  const cfg = loadConfig(ENV.both);
  assert.equal(cfg.defaultSearchProvider, 'both');
  assert.deepEqual([...cfg.fetchProviderOrder], ['exa', 'deepseek']);
  assert.equal(cfg.dedupe, true);
  assert.equal(cfg.timeoutMs, 60000);
});

test('resolveProviders narrows "both" to the configured provider', () => {
  const cfg = loadConfig(ENV.exaOnly);
  const { providers, notes } = resolveProviders(undefined, cfg);
  assert.deepEqual(providers, ['exa']);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Only exa is configured/);
});

test('resolveProviders fans out when both keys exist', () => {
  const cfg = loadConfig(ENV.both);
  const { providers, notes } = resolveProviders('both', cfg);
  assert.deepEqual(providers, ['exa', 'deepseek']);
  assert.deepEqual(notes, []);
});

test('resolveProviders honours an explicit choice', () => {
  const cfg = loadConfig(ENV.both);
  assert.deepEqual(resolveProviders('exa', cfg).providers, ['exa']);
  assert.deepEqual(resolveProviders('deepseek', cfg).providers, ['deepseek']);
});

test('resolveProviders rejects an explicit provider with no key', () => {
  const cfg = loadConfig(ENV.exaOnly);
  assert.throws(() => resolveProviders('deepseek', cfg), ProviderUnavailableError);
  try {
    resolveProviders('deepseek', cfg);
  } catch (err) {
    assert.equal(err.code, 'provider_not_configured');
    assert.deepEqual(err.available, ['exa']);
  }
});

test('resolveFetchOrder follows the configured preference', () => {
  const cfg = loadConfig(ENV.both);
  assert.deepEqual(resolveFetchOrder(undefined, cfg), ['exa', 'deepseek']);
  assert.deepEqual(resolveFetchOrder('deepseek', cfg), ['deepseek']);
});

test('resolveFetchOrder respects a custom order', () => {
  const cfg = loadConfig({ ...ENV.both, FETCH_PROVIDER_ORDER: 'deepseek,exa' });
  assert.deepEqual(resolveFetchOrder(undefined, cfg), ['deepseek', 'exa']);
});

test('resolveFetchOrder drops unconfigured providers from the chain', () => {
  const cfg = loadConfig(ENV.dsOnly);
  assert.deepEqual(resolveFetchOrder(undefined, cfg), ['deepseek']);
});

test('FETCH_PROVIDER_ORDER keeps omitted providers as a last resort', () => {
  const cfg = loadConfig({ ...ENV.both, FETCH_PROVIDER_ORDER: 'deepseek' });
  assert.deepEqual([...cfg.fetchProviderOrder], ['deepseek', 'exa']);
});

test('parseProviderSelector normalises aliases', () => {
  assert.equal(parseProviderSelector(''), 'both');
  assert.equal(parseProviderSelector('AUTO'), 'both');
  assert.equal(parseProviderSelector('all'), 'both');
  assert.equal(parseProviderSelector(' Exa '), 'exa');
  assert.throws(() => parseProviderSelector('bing'), ConfigError);
});

test('parseProviderOrder rejects unknown ids', () => {
  assert.throws(() => parseProviderOrder('exa,google'), ConfigError);
});

test('MERGE_DEDUPE=false disables dedupe', () => {
  const cfg = loadConfig({ ...ENV.both, MERGE_DEDUPE: 'false' });
  assert.equal(cfg.dedupe, false);
});

test('describeConfig never leaks key material', () => {
  const cfg = loadConfig(ENV.both);
  const info = describeConfig(cfg);
  const serialized = JSON.stringify(info);
  assert.equal(serialized.includes('exa-test-key'), false);
  assert.equal(serialized.includes('ds-test-key'), false);
  assert.deepEqual(info.effectiveFetchOrder, ['exa', 'deepseek']);
});
