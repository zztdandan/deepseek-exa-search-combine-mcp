/**
 * DeepSeek adapter.
 *
 * Uses DeepSeek's standalone Search & Fetch JSON API (opened 2026-10-17),
 * which is separate from the chat/Responses endpoints:
 *   POST {base}/v1/tools/search  — in-house engine, rerank scores, authority tiers
 *   POST {base}/v1/tools/fetch   — single page to Markdown
 *
 * Docs: https://api-docs.deepseek.com/guides/search
 * Billing: $0.75 / 1000 successful requests, per request (failed or empty
 * results are not billed).
 */

import { postJson } from '../http.mjs';

const MAX_RESULTS = 50;

export const deepseekProvider = {
  id: 'deepseek',
  label: 'DeepSeek',
  supportsBatchFetch: false,

  /**
   * @returns {Promise<{ results: object[], meta: object }>}
   */
  async search(options) {
    const { config, query, count = 8, needContent = false, oriQuestion, localization, fetchImpl } = options;

    const body = {
      query: String(query),
      count: Math.min(MAX_RESULTS, Math.max(1, Math.trunc(count) || 8)),
      need_content: Boolean(needContent),
    };
    if (oriQuestion) body.ori_question = String(oriQuestion).slice(0, 128);
    if (localization) body.localization = String(localization);

    const data = await postJson(`${config.deepseekBaseUrl}/v1/tools/search`, {
      headers: { authorization: `Bearer ${config.deepseekApiKey}` },
      body,
      timeoutMs: config.timeoutMs,
      fetchImpl,
      provider: 'DeepSeek',
    });

    const results = (data.results || []).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      published: r.date || '',
      author: '',
      site: r.site_name || '',
      snippet: r.snippet || '',
      summary: r.summary || '',
      text: r.content || '',
      score: typeof r.rerank_score === 'number' ? r.rerank_score : undefined,
      authority: typeof r.authority === 'number' ? r.authority : undefined,
    }));

    return { results, meta: { raw: results.length } };
  },

  /**
   * One URL per request — DeepSeek Fetch has no batch form.
   * @returns {Promise<Array<{url:string,title:string,text:string,error?:string}>>}
   */
  async fetch(options) {
    const { config, urls, maxChars = 6000, fetchImpl } = options;
    const pages = [];

    for (const url of urls) {
      try {
        const data = await postJson(`${config.deepseekBaseUrl}/v1/tools/fetch`, {
          headers: { authorization: `Bearer ${config.deepseekApiKey}` },
          body: { url },
          timeoutMs: config.timeoutMs,
          fetchImpl,
          provider: 'DeepSeek',
        });
        const text = data.content || '';
        pages.push({
          url,
          title: data.title || '',
          text: text.length > maxChars ? `${text.slice(0, maxChars)} …[truncated]` : text,
          ...(text.trim() ? {} : { error: 'DeepSeek returned no content for this page' }),
        });
      } catch (err) {
        pages.push({ url, title: '', text: '', error: err?.message || String(err) });
      }
    }

    return pages;
  },
};

export default deepseekProvider;
