/**
 * Markdown rendering.
 *
 * Deliberately separate from the providers: the same result objects can be
 * rendered as compact agent-facing text (default), as JSON, or as anything
 * else later, without touching HTTP or provider code.
 */

const SNIPPET_CHARS = 420;
const SECOND_SNIPPET_CHARS = 180;

/**
 * Squash a provider snippet into one readable line.
 *
 * Exa returns page fragments (newlines, markdown headings) and DeepSeek can
 * return scraped source. Both break the indented list layout, so everything is
 * folded to a single line and obvious markup is dropped.
 */
export function cleanSnippet(text) {
  let value = String(text ?? '');
  if (!value) return '';
  value = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]{1,300}>/g, ' ')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^#{1,6}\s+/, '')
    .trim();
  // Scraped JSX/JS shows up as "…_jsx(_components.p,{children:…". Keep only the
  // readable prefix; if the snippet starts with code there is nothing to show.
  const code = /_jsx[s]?\(|\{children:|\bprops:\{|=>\s*\{|function\s*\(/;
  if (code.test(value)) {
    const cut = value.search(code);
    value = value
      .slice(0, Math.max(0, cut))
      .trim()
      .replace(/[`'"([{,\s]+$/, '')
      .trim();
  }
  return value;
}

function truncate(text, limit) {
  const clean = cleanSnippet(text);
  if (!clean) return '';
  return clean.length > limit ? `${clean.slice(0, limit).trimEnd()} …` : clean;
}

/** Fall back to the URL when a provider gives no title. */
function displayTitle(result) {
  if (result.title && result.title.trim()) return result.title.trim();
  try {
    const url = new URL(result.url);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return result.url || '(untitled)';
  }
}

function metaLine(result) {
  const bits = [];
  bits.push(result.sources.join(' · '));
  if (result.published) bits.push(String(result.published).slice(0, 10));
  if (result.author) bits.push(result.author);
  else if (result.site) bits.push(result.site);
  if (typeof result.authority === 'number') bits.push(`authority ${result.authority}`);
  return bits.join(' · ');
}

/**
 * @param {object} payload
 * @param {string} payload.query
 * @param {object[]} payload.results  merged results
 * @param {object} payload.stats
 * @param {string[]} payload.providers  providers actually queried
 * @param {object[]} payload.failures   providers that errored
 * @param {string[]} [payload.notes]
 * @param {boolean} [payload.includeText]
 */
export function renderSearch(payload) {
  const { query, results, stats, providers, failures = [], notes = [], includeText = false } = payload;
  const headerBits = [`providers: ${providers.join(' + ') || 'none'}`];
  headerBits.push(`${stats.unique} unique of ${stats.raw} raw`);
  if (stats.shared) headerBits.push(`${stats.shared} in both`);

  const out = [`Search "${query}" · ${headerBits.join(' · ')}`, ''];

  if (!results.length) {
    out.push('No results.');
  } else {
    results.forEach((result, i) => {
      out.push(`${i + 1}. ${displayTitle(result)}`);
      out.push(`   ${result.url}`);
      const meta = metaLine(result);
      if (meta) out.push(`   ${meta}`);

      const primary = truncate(result.snippet, SNIPPET_CHARS);
      if (primary) out.push(`   ${primary}`);

      // When both engines found the same page, the second engine's take is
      // often phrased differently — worth one short extra line.
      if (result.shared && Object.keys(result.snippets).length > 1) {
        for (const [provider, snippet] of Object.entries(result.snippets)) {
          if (snippet === result.snippet) continue;
          const extra = truncate(snippet, SECOND_SNIPPET_CHARS);
          if (extra && extra !== primary) out.push(`   ${provider}: ${extra}`);
        }
      }

      if (includeText && result.text) {
        out.push('   ── content ──');
        // Body text keeps its newlines — it is read, not skimmed.
        const body = String(result.text).replace(/\r\n/g, '\n').trim();
        const limited = body.length > 4000 ? `${body.slice(0, 4000)} …` : body;
        for (const line of limited.split('\n')) out.push(`   ${line}`);
      }
      out.push('');
    });
  }

  const footNotes = [...notes];
  for (const failure of failures) {
    footNotes.push(
      `${failure.provider} failed: ${failure.error.message}` +
        (failure.error.retryable ? ' (retryable)' : ''),
    );
  }
  if (footNotes.length) {
    out.push('Notes:');
    for (const note of footNotes) out.push(`- ${note}`);
  }

  return out.join('\n').trimEnd();
}

/**
 * @param {{pages: object[], attempts: object[], order: string[]}} payload
 */
export function renderFetch(payload) {
  const { pages = [], attempts = [], order = [] } = payload;
  const out = [
    `Fetch · ${pages.length} ok, ${attempts.length} failed · order: ${order.join(' → ') || 'none'}`,
    '',
  ];

  pages.forEach((page, i) => {
    out.push(`${i + 1}. ${displayTitle(page)}`);
    out.push(`   ${page.url}`);
    out.push(`   ${page.provider}`);
    out.push('');
    for (const line of String(page.text || '').trim().split('\n')) out.push(`   ${line}`);
    out.push('');
  });

  if (attempts.length) {
    out.push('Failed:');
    for (const attempt of attempts) out.push(`- ${attempt.url} (${attempt.provider}): ${attempt.error}`);
  }

  return out.join('\n').trimEnd();
}
