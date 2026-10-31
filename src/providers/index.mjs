/**
 * Provider registry and fan-out.
 *
 * The fan-out contract is the heart of this server: every backend is queried
 * concurrently and each one fails independently. A dead or rate-limited
 * provider must never remove the other provider's results.
 */

import { exaProvider } from './exa.mjs';
import { deepseekProvider } from './deepseek.mjs';

/** @type {Record<string, any>} */
export const PROVIDERS = {
  exa: exaProvider,
  deepseek: deepseekProvider,
};

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

/**
 * Query every provider concurrently.
 *
 * @param {string[]} providerIds
 * @param {object} options  forwarded to each provider.search
 * @returns {Promise<Array<{provider:string, ok:boolean, results:object[], meta:object, error?:object}>>}
 */
export async function fanOutSearch(providerIds, options) {
  const runs = providerIds.map(async (id) => {
    const provider = getProvider(id);
    try {
      const { results, meta } = await provider.search(options);
      return { provider: id, ok: true, results: results || [], meta: meta || {} };
    } catch (err) {
      return {
        provider: id,
        ok: false,
        results: [],
        meta: {},
        error: {
          message: err?.message || String(err),
          status: err?.status,
          code: err?.code,
          retryable: err?.retryable,
        },
      };
    }
  });

  return Promise.all(runs);
}

/**
 * Fetch pages through an ordered provider list, stopping at the first provider
 * that actually returns text for a URL.
 *
 * @param {string[]} order
 * @param {object} options
 * @returns {Promise<{pages: object[], attempts: object[]}>}
 */
export async function orderedFetch(order, options) {
  const { urls, maxChars = 6000 } = options;
  const pending = [...urls];
  const pages = [];
  const attempts = [];

  for (const id of order) {
    if (!pending.length) break;
    const provider = getProvider(id);

    try {
      if (provider.supportsBatchFetch) {
        const batch = await provider.fetch({ ...options, urls: pending, maxChars });
        const stillPending = [];
        for (const page of batch) {
          if (page.text && page.text.trim()) {
            pages.push({ ...page, provider: id });
          } else {
            stillPending.push(page.url);
            attempts.push({ provider: id, url: page.url, error: page.error || 'empty content' });
          }
        }
        // URLs the provider dropped entirely also stay pending.
        for (const url of pending) {
          if (!batch.some((p) => p.url === url) && !stillPending.includes(url)) stillPending.push(url);
        }
        pending.splice(0, pending.length, ...stillPending);
      } else {
        const settled = await provider.fetch({ ...options, urls: [...pending], maxChars });
        const stillPending = [];
        for (const page of settled) {
          if (page.text && page.text.trim()) {
            pages.push({ ...page, provider: id });
          } else {
            stillPending.push(page.url);
            attempts.push({ provider: id, url: page.url, error: page.error || 'empty content' });
          }
        }
        pending.splice(0, pending.length, ...stillPending);
      }
    } catch (err) {
      attempts.push({ provider: id, url: pending.join(','), error: err?.message || String(err) });
      // move on to the next provider rather than aborting the whole call
    }
  }

  for (const url of pending) {
    attempts.push({ provider: 'none', url, error: 'no configured provider returned content' });
  }

  return { pages, attempts };
}
