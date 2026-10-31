/**
 * Public entry point. Import the server programmatically:
 *
 *   import { loadConfig, createDispatcher } from 'deepseek-exa-search-combine-mcp';
 *   const dispatch = createDispatcher({ config: loadConfig(process.env) });
 */

export { loadConfig, resolveProviders, resolveFetchOrder, describeConfig, ConfigError, ProviderUnavailableError, PROVIDER_IDS, DEFAULT_FETCH_ORDER } from './config.mjs';
export { createDispatcher, serverSummary, SERVER_NAME, SERVER_VERSION, SUPPORTED_PROTOCOLS, SERVER_INSTRUCTIONS } from './server.mjs';
export { TOOL_DEFINITIONS, callTool } from './tools.mjs';
export { mergeSearchResults, normalizeUrl } from './merge.mjs';
export { renderSearch, renderFetch } from './render.mjs';
export { fanOutSearch, orderedFetch, PROVIDERS, getProvider } from './providers/index.mjs';
export { serveStdio } from './transports/stdio.mjs';
export { HttpError, postJson } from './http.mjs';
