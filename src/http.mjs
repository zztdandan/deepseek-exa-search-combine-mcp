/**
 * One HTTP helper for every provider.
 *
 * Responsibilities kept deliberately narrow: attach a timeout, surface a
 * useful error for non-2xx responses, and never leak the API key into a
 * message or log line. Provider-specific field mapping lives in
 * src/providers/*.
 */

export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', code = '', retryable = false, body = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.code = code;
    this.retryable = retryable;
    this.body = body;
  }

  /** Compact, model-friendly description. */
  toWire() {
    return {
      error: this.message,
      status: this.status || undefined,
      code: this.code || undefined,
      retryable: this.retryable || undefined,
    };
  }
}

/**
 * Pull the most useful message out of a provider error body.
 * Exa uses `{ error, tag }`; DeepSeek uses OpenAI's `{ error: { message } }`.
 */
function extractMessage(parsed, raw, status) {
  if (parsed && typeof parsed === 'object') {
    const err = /** @type {any} */ (parsed).error;
    if (typeof err === 'string' && err.trim()) return err.trim();
    if (err && typeof err === 'object') {
      if (typeof err.message === 'string' && err.message.trim()) return err.message.trim();
    }
    const direct = /** @type {any} */ (parsed).message;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
  }
  const text = String(raw || '').trim();
  return text ? text.slice(0, 400) : `HTTP ${status}`;
}

function extractCode(parsed) {
  if (parsed && typeof parsed === 'object') {
    const err = /** @type {any} */ (parsed).error;
    if (err && typeof err === 'object' && typeof err.code === 'string') return err.code;
    if (typeof /** @type {any} */ (parsed).code === 'string') return /** @type {any} */ (parsed).code;
    if (typeof /** @type {any} */ (parsed).tag === 'string') return /** @type {any} */ (parsed).tag;
  }
  return '';
}

/**
 * POST JSON and return the parsed body.
 *
 * @param {string} url
 * @param {{ headers?: Record<string,string>, body?: unknown, timeoutMs?: number,
 *           fetchImpl?: typeof fetch, provider?: string }} options
 * @returns {Promise<any>}
 */
export async function postJson(url, options = {}) {
  const {
    headers = {},
    body = {},
    timeoutMs = 60_000,
    fetchImpl = globalThis.fetch,
    provider = 'provider',
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new HttpError('No fetch implementation available (Node 20+ required).', {
      url,
      code: 'no_fetch',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  let raw = '';
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    raw = await response.text();
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new HttpError(`${provider} timed out after ${timeoutMs}ms`, {
        url,
        code: 'timeout',
        retryable: true,
      });
    }
    throw new HttpError(`${provider} request failed: ${err?.message || String(err)}`, {
      url,
      code: 'network_error',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  let parsed = null;
  const looksJson = raw && /^[\s]*[[{]/.test(raw);
  if (looksJson) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    throw new HttpError(extractMessage(parsed, raw, response.status), {
      status: response.status,
      url,
      code: extractCode(parsed),
      retryable: RETRYABLE_STATUS.has(response.status),
      body: parsed,
    });
  }

  if (parsed === null) {
    // A 2xx that is not JSON means we cannot trust the payload.
    throw new HttpError(`${provider} returned a non-JSON response`, {
      status: response.status,
      url,
      code: 'invalid_response',
      body: raw.slice(0, 400),
    });
  }

  return parsed;
}
