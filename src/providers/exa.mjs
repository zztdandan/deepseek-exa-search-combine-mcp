/**
 * Exa adapter.
 *
 * Endpoints:
 *   POST {base}/search    — neural/keyword web search, optional page text
 *   POST {base}/contents  — batch page extraction
 *
 * Docs: https://docs.exa.ai/reference/search
 */

import { postJson } from '../http.mjs';

const MAX_RESULTS = 100;

export const exaProvider = {
  id: 'exa',
  label: 'Exa',
  supportsBatchFetch: true,

  /**
   * @returns {Promise<{ results: object[], meta: object }>}
   */
  async search(options) {
    const {
      config,
      query,
      count = 8,
      needContent = false,
      maxChars = 4000,
      includeDomains,
      excludeDomains,
      startPublishedDate,
      endPublishedDate,
      category,
      type,
      fetchImpl,
    } = options;

    const body = {
      query: String(query),
      type: type || 'auto',
      numResults: Math.min(MAX_RESULTS, Math.max(1, Math.trunc(count) || 8)),
      // highlights stay on so every hit has a readable snippet; text is opt-in
      // because it dominates the token bill.
      contents: needContent
        ? { highlights: true, text: { maxCharacters: Math.max(200, Math.trunc(maxChars) || 4000) } }
        : { highlights: true },
    };

    if (Array.isArray(includeDomains) && includeDomains.length) body.includeDomains = includeDomains;
    if (Array.isArray(excludeDomains) && excludeDomains.length) body.excludeDomains = excludeDomains;
    if (startPublishedDate) body.startPublishedDate = startPublishedDate;
    if (endPublishedDate) body.endPublishedDate = endPublishedDate;
    if (category) body.category = category;

    const data = await postJson(`${config.exaBaseUrl}/search`, {
      headers: { 'x-api-key': config.exaApiKey },
      body,
      timeoutMs: config.timeoutMs,
      fetchImpl,
      provider: 'Exa',
    });

    const results = (data.results || []).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      published: r.publishedDate || '',
      author: r.author || '',
      site: '',
      snippet: Array.isArray(r.highlights) && r.highlights.length ? r.highlights.join(' … ') : r.summary || '',
      summary: r.summary || '',
      text: r.text || '',
      score: Array.isArray(r.highlightScores) && typeof r.highlightScores[0] === 'number'
        ? r.highlightScores[0]
        : undefined,
    }));

    return {
      results,
      meta: {
        cost: typeof data.costDollars?.total === 'number' ? data.costDollars.total : undefined,
        requestId: data.requestId,
      },
    };
  },

  /**
   * Batch extraction. Exa takes many URLs per call, so one request covers the
   * whole list.
   * @returns {Promise<Array<{url:string,title:string,text:string,error?:string}>>}
   */
  async fetch(options) {
    const { config, urls, maxChars = 6000, fetchImpl } = options;
    if (!urls.length) return [];

    const data = await postJson(`${config.exaBaseUrl}/contents`, {
      headers: { 'x-api-key': config.exaApiKey },
      body: {
        urls,
        text: { maxCharacters: Math.max(200, Math.trunc(maxChars) || 6000) },
      },
      timeoutMs: config.timeoutMs,
      fetchImpl,
      provider: 'Exa',
    });

    const byUrl = new Map();
    for (const r of data.results || []) {
      const text = r.text || '';
      byUrl.set(r.url, {
        url: r.url,
        title: r.title || '',
        text,
        ...(text.trim() ? {} : { error: 'Exa returned no text for this page' }),
      });
    }

    // Preserve the caller's order and flag URLs Exa silently dropped.
    return urls.map(
      (url) =>
        byUrl.get(url) || { url, title: '', text: '', error: 'Exa returned no result for this URL' },
    );
  },
};

export default exaProvider;
