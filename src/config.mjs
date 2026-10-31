/**
 * Configuration and provider resolution.
 *
 * Every setting comes from the environment so the server stays a pure stdio
 * child process with no config file to locate. `loadConfig()` is pure: pass an
 * env object and get a frozen config back, which is what makes it testable.
 */

export const PROVIDER_IDS = /** @type {const} */ (['exa', 'deepseek']);

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_SEARCH_PROVIDER = 'both';
export const DEFAULT_FETCH_ORDER = /** @type {const} */ (['exa', 'deepseek']);

/** Raised for problems the operator can fix by changing env vars. */
export class ConfigError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'ConfigError';
    this.hint = hint;
  }
}

/** Raised when a caller asks for a backend that has no API key configured. */
export class ProviderUnavailableError extends Error {
  constructor(provider, available) {
    super(
      `Provider "${provider}" is not configured (no API key). ` +
        `Available: ${available.length ? available.join(', ') : 'none'}.`,
    );
    this.name = 'ProviderUnavailableError';
    this.code = 'provider_not_configured';
    this.provider = provider;
    this.available = available;
  }
}

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function stripTrailingSlash(url) {
  return String(url).replace(/\/+$/, '');
}

/**
 * Parse a provider selector. Accepts "both", "auto", "", or a provider id.
 * @returns {'both'|'exa'|'deepseek'}
 */
export function parseProviderSelector(raw, fallback) {
  const value = trim(raw).toLowerCase();
  if (!value || value === 'auto' || value === 'both' || value === 'all') return 'both';
  if (PROVIDER_IDS.includes(value)) return /** @type {any} */ (value);
  throw new ConfigError(
    `Unknown provider "${raw}". Expected one of: both, ${PROVIDER_IDS.join(', ')}.`,
    'Set DEFAULT_SEARCH_PROVIDER / FETCH_PROVIDER_ORDER to a valid value.',
  );
}

/**
 * Parse an ordered, comma separated provider list (fetch fallback order).
 * @returns {string[]}
 */
export function parseProviderOrder(raw, fallback = DEFAULT_FETCH_ORDER) {
  const base = trim(raw);
  if (!base) return [...fallback];
  const seen = new Set();
  const order = [];
  for (const part of base.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if (!PROVIDER_IDS.includes(part)) {
      throw new ConfigError(
        `Unknown provider "${part}" in FETCH_PROVIDER_ORDER. Expected: ${PROVIDER_IDS.join(', ')}.`,
        'Example: FETCH_PROVIDER_ORDER=exa,deepseek',
      );
    }
    if (!seen.has(part)) {
      seen.add(part);
      order.push(part);
    }
  }
  if (!order.length) return [...fallback];
  // Any provider the operator left out keeps working, just later in line.
  for (const id of PROVIDER_IDS) if (!seen.has(id)) order.push(id);
  return order;
}

/**
 * Build the immutable runtime config.
 *
 * Throws ConfigError when neither key is present: a search server with zero
 * backends can only ever fail, so failing at startup is kinder than failing
 * on the first tool call.
 */
export function loadConfig(env = process.env) {
  const exaApiKey = trim(env.EXA_API_KEY);
  const deepseekApiKey = trim(env.DEEPSEEK_API_KEY);

  const available = PROVIDER_IDS.filter((id) =>
    id === 'exa' ? Boolean(exaApiKey) : Boolean(deepseekApiKey),
  );

  if (!available.length) {
    throw new ConfigError(
      'No API keys configured. Set at least one of EXA_API_KEY or DEEPSEEK_API_KEY.',
      'You can run with only one provider; search defaults to whichever key exists.',
    );
  }

  const defaultSearchProvider = parseProviderSelector(
    env.DEFAULT_SEARCH_PROVIDER,
    DEFAULT_SEARCH_PROVIDER,
  );
  const fetchProviderOrder = parseProviderOrder(env.FETCH_PROVIDER_ORDER, DEFAULT_FETCH_ORDER);

  return Object.freeze({
    exaApiKey,
    deepseekApiKey,
    exaBaseUrl: stripTrailingSlash(trim(env.EXA_BASE_URL) || 'https://api.exa.ai'),
    deepseekBaseUrl: stripTrailingSlash(trim(env.DEEPSEEK_BASE_URL) || 'https://api.deepseek.com'),
    timeoutMs: positiveInt(env.SEARCH_HTTP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    defaultSearchProvider,
    fetchProviderOrder,
    dedupe: trim(env.MERGE_DEDUPE).toLowerCase() !== 'false',
    availableProviders: Object.freeze([...available]),
    configured: Object.freeze({
      exa: Boolean(exaApiKey),
      deepseek: Boolean(deepseekApiKey),
    }),
  });
}

/**
 * Turn a caller's provider request into the concrete list to query.
 *
 * - "both" (or omitted) fans out to every configured backend; with a single
 *   key it silently narrows to that one instead of emitting a half-empty
 *   error block.
 * - An explicit provider that has no key is a hard error: the caller asked for
 *   something specific, so guessing would hide the misconfiguration.
 *
 * @returns {{ providers: string[], notes: string[] }}
 */
export function resolveProviders(requested, config) {
  const selector = parseProviderSelector(requested ?? '', config.defaultSearchProvider);

  if (selector === 'both') {
    const providers = [...config.availableProviders];
    const notes = [];
    if (providers.length === 1) {
      notes.push(
        `Only ${providers[0]} is configured, so "both" resolved to ${providers[0]}. ` +
          `Add the other API key to combine providers.`,
      );
    }
    return { providers, notes };
  }

  if (!config.availableProviders.includes(selector)) {
    throw new ProviderUnavailableError(selector, [...config.availableProviders]);
  }
  return { providers: [selector], notes: [] };
}

/**
 * Ordered fallback list for fetch: explicit request wins, otherwise the
 * configured preference order filtered down to what is actually usable.
 */
export function resolveFetchOrder(requested, config) {
  const selector = parseProviderSelector(requested ?? '', 'both');

  if (selector !== 'both') {
    if (!config.availableProviders.includes(selector)) {
      throw new ProviderUnavailableError(selector, [...config.availableProviders]);
    }
    return [selector];
  }

  const order = config.fetchProviderOrder.filter((id) => config.availableProviders.includes(id));
  return order.length ? order : [...config.availableProviders];
}

/** Redacted one-line summary, safe to log or return to an agent. */
export function describeConfig(config) {
  const keys = PROVIDER_IDS.map(
    (id) => `${id}: ${config.configured[id] ? 'configured' : 'missing'}`,
  ).join(' · ');
  const effectiveFetch = config.fetchProviderOrder.filter((id) => config.configured[id]);
  return {
    providers: keys,
    defaultSearchProvider: config.defaultSearchProvider,
    fetchProviderOrder: config.fetchProviderOrder,
    effectiveFetchOrder: effectiveFetch,
    dedupe: config.dedupe,
    timeoutMs: config.timeoutMs,
  };
}
