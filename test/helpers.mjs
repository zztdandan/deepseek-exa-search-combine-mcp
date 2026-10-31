/** Shared test helpers: a scriptable fetch double. */

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Build a fetch double from route matchers.
 * @param {Array<{match:(url:string, body:any)=>boolean, respond:(url:string, body:any)=>Response}>} routes
 */
export function makeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body, headers: init.headers || {} });
    for (const route of routes) {
      if (route.match(url, body)) return route.respond(url, body);
    }
    throw new Error(`unexpected request: ${url}`);
  };
  impl.calls = calls;
  return impl;
}

export const isExaSearch = (url) => url === 'https://api.exa.ai/search';
export const isExaContents = (url) => url === 'https://api.exa.ai/contents';
export const isDsSearch = (url) => url === 'https://api.deepseek.com/v1/tools/search';
export const isDsFetch = (url) => url === 'https://api.deepseek.com/v1/tools/fetch';

export function exaPayload(results) {
  return jsonResponse({
    requestId: 'exa-req',
    results,
    costDollars: { total: 0.007 },
  });
}

export function dsPayload(results) {
  return jsonResponse({ results });
}

export function dsFetchPayload(title, content) {
  return jsonResponse({ title, content });
}

export const ENV = {
  both: { EXA_API_KEY: 'exa-test-key', DEEPSEEK_API_KEY: 'ds-test-key' },
  exaOnly: { EXA_API_KEY: 'exa-test-key' },
  dsOnly: { DEEPSEEK_API_KEY: 'ds-test-key' },
};
