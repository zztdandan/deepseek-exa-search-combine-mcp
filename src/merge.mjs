/**
 * Cross-provider merging.
 *
 * "Combine" means more than concatenating two lists: the same page found by
 * both engines should collapse into one entry that records both sources, so
 * the agent reads one ranked list instead of two overlapping ones.
 */

const TRACKING_PARAM =
  /^(utm_|ga_|mc_|pk_)|^(ref|referrer|fbclid|gclid|dclid|msclkid|yclid|igshid|spm|scid|trk|oly_enc_id|vero_id|_hsenc|_hsmi|_ga)$/i;

/**
 * Canonical form used only for comparing URLs. Anything that does not parse
 * falls back to a trimmed string so dedupe still has a stable key.
 */
export function normalizeUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    // Collapse duplicate slashes and drop a trailing slash on the path, not on
    // the whole string — with a query string the two are not the same place.
    const cleanPath = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    url.pathname = cleanPath || '/';

    return url
      .toString()
      .replace(/\?$/, '')
      .replace(/^(https?:\/\/[^/?#]+)\/$/, '$1');
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function pickSnippet(entry) {
  return entry.snippet || entry.summary || '';
}

/**
 * @param {Array<{provider:string, results:object[]}>} batches
 * @param {{dedupe?: boolean}} [options]
 * @returns {{results: object[], stats: object}}
 */
export function mergeSearchResults(batches, options = {}) {
  const dedupe = options.dedupe !== false;
  const stats = {
    raw: 0,
    unique: 0,
    shared: 0,
    dedupeApplied: dedupe,
    byProvider: /** @type {Record<string, number>} */ ({}),
  };

  const ordered = [];
  const index = new Map();

  for (const batch of batches) {
    stats.byProvider[batch.provider] = batch.results.length;
    for (const result of batch.results) {
      stats.raw += 1;
      const key = dedupe ? normalizeUrl(result.url) : `${batch.provider}:${stats.raw}`;

      const existing = key ? index.get(key) : undefined;
      if (existing) {
        existing.sources.add(batch.provider);
        const snippet = pickSnippet(result);
        if (snippet) existing.snippets[batch.provider] = snippet;
        // Fill gaps with the other engine's values instead of dropping them.
        for (const field of ['title', 'published', 'author', 'site', 'summary']) {
          if (!existing[field] && result[field]) existing[field] = result[field];
        }
        if (!existing.text && result.text) existing.text = result.text;
        if (existing.score === undefined && result.score !== undefined) existing.score = result.score;
        if (existing.authority === undefined && result.authority !== undefined) {
          existing.authority = result.authority;
        }
        continue;
      }

      const entry = {
        title: result.title || '',
        url: result.url || '',
        published: result.published || '',
        author: result.author || '',
        site: result.site || '',
        snippet: pickSnippet(result),
        summary: result.summary || '',
        text: result.text || '',
        score: result.score,
        authority: result.authority,
        sources: new Set([batch.provider]),
        snippets: /** @type {Record<string,string>} */ ({}),
      };
      const snippet = pickSnippet(result);
      if (snippet) entry.snippets[batch.provider] = snippet;

      if (key) index.set(key, entry);
      ordered.push(entry);
    }
  }

  const results = ordered.map((entry) => {
    const sources = [...entry.sources];
    return {
      title: entry.title,
      url: entry.url,
      published: entry.published,
      author: entry.author,
      site: entry.site,
      snippet: entry.snippet,
      summary: entry.summary,
      text: entry.text,
      score: entry.score,
      authority: entry.authority,
      sources,
      snippets: entry.snippets,
      shared: sources.length > 1,
    };
  });

  stats.unique = results.length;
  stats.shared = results.filter((r) => r.shared).length;

  return { results, stats };
}
