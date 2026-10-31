/**
 * JSON-RPC dispatch, transport agnostic.
 *
 * `createDispatcher` takes config plus an optional fetch implementation and
 * returns a pure async function: message in, response out (or null for
 * notifications). That keeps the protocol testable in-process without
 * spawning a child process or mocking stdio.
 */

import { createRequire } from 'node:module';
import { TOOL_DEFINITIONS, callTool } from './tools.mjs';
import { describeConfig } from './config.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const SERVER_NAME = 'deepseek-exa-search-combine';
export const SERVER_VERSION = pkg.version;
export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const SERVER_INSTRUCTIONS =
  'Combined web search over DeepSeek and Exa in a single call. ' +
  'Use "search" with no provider argument to query every configured backend at once and receive one ' +
  'deduplicated list; pages found by both engines are marked with multiple sources. ' +
  'Use "fetch" for full page content — providers are tried in the configured fallback order (Exa first by default). ' +
  'Use "status" to see which backends are configured.';

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

function errorResponse(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function successResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function pickProtocol(requested) {
  if (requested && SUPPORTED_PROTOCOLS.includes(requested)) return requested;
  return SUPPORTED_PROTOCOLS[0];
}

/**
 * @param {{config: object, fetchImpl?: typeof fetch, log?: (...a:any[])=>void,
 *          enableStructuredContent?: boolean}} options
 */
export function createDispatcher(options) {
  const { config, fetchImpl = globalThis.fetch, log = () => {} } = options;

  async function handleToolCall(id, params) {
    const name = params?.name;
    const args = params?.arguments ?? {};

    if (typeof name !== 'string' || !name) {
      return errorResponse(id, JSONRPC_INVALID_PARAMS, 'tools/call requires a tool name');
    }
    if (!TOOL_DEFINITIONS.some((tool) => tool.name === name)) {
      return errorResponse(id, JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
    }

    try {
      const outcome = await callTool(name, args, { config, fetchImpl });
      const result = { content: [{ type: 'text', text: outcome.text }] };
      if (outcome.isError) result.isError = true;
      return successResponse(id, result);
    } catch (err) {
      // Tool-level failures (bad arguments, unknown provider) are reported as
      // tool errors, not transport errors — the protocol stayed healthy.
      log('tool error', name, err?.message);
      return successResponse(id, {
        content: [{ type: 'text', text: `${name} failed: ${err?.message || String(err)}` }],
        isError: true,
      });
    }
  }

  /**
   * @param {any} message
   * @returns {Promise<object|null>} response frame, or null for notifications
   */
  return async function dispatch(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return errorResponse(null, JSONRPC_INVALID_REQUEST, 'Expected a single JSON-RPC object');
    }
    if (message.jsonrpc !== '2.0') {
      return errorResponse(message.id ?? null, JSONRPC_INVALID_REQUEST, 'jsonrpc must be "2.0"');
    }

    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;

    if (typeof method !== 'string') {
      if (isNotification) return null;
      return errorResponse(id, JSONRPC_INVALID_REQUEST, 'method must be a string');
    }

    try {
      switch (method) {
        case 'initialize': {
          const protocolVersion = pickProtocol(params?.protocolVersion);
          const client = params?.clientInfo;
          if (client?.name) log(`initialize from ${client.name}@${client.version || '?'} → ${protocolVersion}`);
          return successResponse(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION, title: 'DeepSeek × Exa Search Combine MCP' },
            instructions: SERVER_INSTRUCTIONS,
          });
        }

        case 'notifications/initialized':
        case 'initialized':
        case 'notifications/cancelled':
        case 'notifications/progress':
        case 'notifications/roots/list_changed':
          return null;

        case 'ping':
          return isNotification ? null : successResponse(id, {});

        case 'tools/list':
          return successResponse(id, { tools: TOOL_DEFINITIONS });

        case 'tools/call':
          return handleToolCall(id, params);

        case 'resources/list':
          return successResponse(id, { resources: [] });

        case 'resources/templates/list':
          return successResponse(id, { resourceTemplates: [] });

        case 'prompts/list':
          return successResponse(id, { prompts: [] });

        case 'shutdown':
          return successResponse(id, {});

        case 'exit':
          return null;

        default:
          if (isNotification) return null;
          return errorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (err) {
      log('dispatch error', err?.stack || err?.message);
      if (isNotification) return null;
      return errorResponse(id, JSONRPC_INTERNAL_ERROR, err?.message || 'Internal error');
    }
  };
}

/** Convenience for CLI / doctor output. */
export function serverSummary(config) {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools: TOOL_DEFINITIONS.map((t) => t.name),
    ...describeConfig(config),
  };
}

export { JSONRPC_PARSE_ERROR, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND, JSONRPC_INVALID_PARAMS, JSONRPC_INTERNAL_ERROR };
