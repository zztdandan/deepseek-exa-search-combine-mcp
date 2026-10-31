import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.mjs';
import { createDispatcher, SERVER_NAME, SERVER_VERSION } from '../src/server.mjs';
import { ENV } from './helpers.mjs';

function dispatcher(env = ENV.both) {
  return createDispatcher({ config: loadConfig(env), fetchImpl: async () => { throw new Error('no network in tests'); } });
}

test('initialize negotiates the requested protocol version', async () => {
  const dispatch = dispatcher();
  const res = await dispatch({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
  });

  assert.equal(res.result.protocolVersion, '2025-03-26');
  assert.equal(res.result.serverInfo.name, SERVER_NAME);
  assert.equal(res.result.serverInfo.version, SERVER_VERSION);
  assert.ok(res.result.capabilities.tools);
  assert.match(res.result.instructions, /deduplicated/);
});

test('initialize falls back to the newest supported protocol', async () => {
  const dispatch = dispatcher();
  const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(res.result.protocolVersion, '2025-06-18');
});

test('tools/list exposes the three documented tools', async () => {
  const dispatch = dispatcher();
  const res = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = res.result.tools.map((t) => t.name);
  assert.deepEqual(names, ['search', 'fetch', 'status']);

  const search = res.result.tools.find((t) => t.name === 'search');
  assert.deepEqual(search.inputSchema.required, ['query']);
  assert.deepEqual(search.inputSchema.properties.provider.enum, ['both', 'exa', 'deepseek']);
  assert.equal(search.inputSchema.additionalProperties, false);
});

test('tools/call status works end to end', async () => {
  const dispatch = dispatcher(ENV.exaOnly);
  const res = await dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'status', arguments: {} } });
  const text = res.result.content[0].text;
  assert.match(text, /exa: configured/);
  assert.match(text, /deepseek: missing/);
  assert.equal(res.result.isError, undefined);
});

test('unknown tool is an invalid-params error', async () => {
  const dispatch = dispatcher();
  const res = await dispatch({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(res.error.code, -32602);
});

test('tools/call without a name is rejected', async () => {
  const dispatch = dispatcher();
  const res = await dispatch({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} });
  assert.equal(res.error.code, -32602);
});

test('unknown method is -32601', async () => {
  const dispatch = dispatcher();
  const res = await dispatch({ jsonrpc: '2.0', id: 6, method: 'does/not/exist' });
  assert.equal(res.error.code, -32601);
});

test('notifications produce no response', async () => {
  const dispatch = dispatcher();
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }), null);
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'unknown/notification' }), null);
});

test('ping answers', async () => {
  const dispatch = dispatcher();
  const res = await dispatch({ jsonrpc: '2.0', id: 7, method: 'ping' });
  assert.deepEqual(res, { jsonrpc: '2.0', id: 7, result: {} });
});

test('resources and prompts report empty lists', async () => {
  const dispatch = dispatcher();
  assert.deepEqual((await dispatch({ jsonrpc: '2.0', id: 8, method: 'resources/list' })).result, { resources: [] });
  assert.deepEqual((await dispatch({ jsonrpc: '2.0', id: 9, method: 'prompts/list' })).result, { prompts: [] });
});

test('bad envelope is rejected', async () => {
  const dispatch = dispatcher();
  assert.equal((await dispatch({ id: 1, method: 'ping' })).error.code, -32600);
  assert.equal((await dispatch({ jsonrpc: '2.0', id: 1 })).error.code, -32600);
  assert.equal((await dispatch([])).error.code, -32600);
  assert.equal((await dispatch(null)).error.code, -32600);
});

test('tool-level failure is reported as a tool error, not a transport error', async () => {
  const dispatch = dispatcher(ENV.exaOnly);
  const res = await dispatch({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name: 'search', arguments: { query: 'q', provider: 'deepseek' } },
  });
  assert.equal(res.error, undefined);
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /not configured/);
});
