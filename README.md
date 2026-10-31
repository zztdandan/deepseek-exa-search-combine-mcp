# DeepSeek × Exa Search Combine MCP

[![CI](https://github.com/zztdandan/deepseek-exa-search-combine-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/zztdandan/deepseek-exa-search-combine-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/deepseek-exa-search-combine-mcp.svg)](https://www.npmjs.com/package/deepseek-exa-search-combine-mcp)
[![license](https://img.shields.io/npm/l/deepseek-exa-search-combine-mcp.svg)](./LICENSE)

One stdio MCP server that queries **DeepSeek** and **Exa** at the same time and hands your agent a
**single deduplicated result list** — instead of two overlapping ones it has to reconcile itself.

Configure both API keys, or just one. If only one key exists, `"both"` quietly narrows to that
provider instead of failing.

- **Zero dependencies.** Node built-ins only (`fetch`, `readline`). Nothing to audit, nothing to break.
- **One process, two engines.** `search` fans out in parallel; pages found by both are merged into one
  entry labelled with every source.
- **Independent failure.** A rate-limited or broken provider never removes the other provider's results.
- **Configurable fetch preference.** Exa first by default, swap the order with one env var.

---

## Why this exists

Both vendors ship a search MCP. Neither combines them:

| Package | Limitation |
|---|---|
| `exa-mcp-server` | Exa only |
| `deepseek-mcp-server` | No standalone search tool — `web_search` is a flag inside `create_response`, honoured only by `deepseek-v4-pro` |

DeepSeek's dedicated Search & Fetch API (`/v1/tools/search`, `/v1/tools/fetch`, opened 2026-10-17) is a
separate JSON API from its chat endpoints, so nothing was using it as a first-class search backend.
This server does, and merges what it returns with Exa.

---

## Install

```bash
# run without installing
npx -y deepseek-exa-search-combine-mcp

# or install globally
npm i -g deepseek-exa-search-combine-mcp
dxsc status
```

Requires **Node.js 20+** (global `fetch`).

---

## Configure

| Variable | Required | Default | Notes |
|---|---|---|---|
| `EXA_API_KEY` | one of these | — | https://dashboard.exa.ai/api-keys |
| `DEEPSEEK_API_KEY` | one of these | — | https://platform.deepseek.com/api_keys |
| `DEFAULT_SEARCH_PROVIDER` | no | `both` | `both` \| `exa` \| `deepseek` — used when a tool call omits `provider` |
| `FETCH_PROVIDER_ORDER` | no | `exa,deepseek` | Fallback order for `fetch` |
| `SEARCH_HTTP_TIMEOUT_MS` | no | `60000` | Per-request deadline |
| `EXA_BASE_URL` | no | `https://api.exa.ai` | Override for proxies/gateways |
| `DEEPSEEK_BASE_URL` | no | `https://api.deepseek.com` | Override for proxies/gateways |
| `MERGE_DEDUPE` | no | `true` | Set to `false` to disable cross-provider URL merging |

At least one of `EXA_API_KEY` / `DEEPSEEK_API_KEY` must be set — the server refuses to start with
neither, because a search server with zero backends can only fail later and less clearly.

### Client configuration

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "deepseek-exa-search-combine-mcp"],
      "env": {
        "EXA_API_KEY": "your-exa-key",
        "DEEPSEEK_API_KEY": "your-deepseek-key"
      }
    }
  }
}
```

<details>
<summary>Claude Desktop / Cursor / Codex / QwenPaw</summary>

The block above works unchanged for Claude Desktop (`claude_desktop_config.json`), Cursor
(`~/.cursor/mcp.json`) and most other clients.

Codex CLI:

```bash
codex mcp add search \
  --env EXA_API_KEY=your-exa-key \
  --env DEEPSEEK_API_KEY=your-deepseek-key \
  -- npx -y deepseek-exa-search-combine-mcp
```

Using a local checkout instead of `npx` avoids any launcher ambiguity on Windows — point `command`
straight at the binary:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/deepseek-exa-search-combine-mcp/bin/dxsc.mjs"],
  "env": { "EXA_API_KEY": "…", "DEEPSEEK_API_KEY": "…" }
}
```

</details>

---

## Tools

### `search`

Queries every configured provider in parallel, merges and deduplicates.

| Parameter | Type | Default | Applies to |
|---|---|---|---|
| `query` *(required)* | string | — | both |
| `provider` | `both` \| `exa` \| `deepseek` | `both` | — |
| `count` | integer 1–100 | 8 | Exa ≤ 100, DeepSeek ≤ 50 (clamped per provider) |
| `need_content` | boolean | false | both — also return page body |
| `max_chars` | integer 200–20000 | 4000 | both — per-page text cap |
| `include_domains` | string[] | — | Exa |
| `exclude_domains` | string[] | — | Exa |
| `start_published_date` | ISO 8601 | — | Exa |
| `end_published_date` | ISO 8601 | — | Exa |
| `category` | `company` \| `publication` \| `news` \| `personal site` \| `financial report` \| `people` | — | Exa |
| `type` | `auto` \| `lite` \| `deep-lite` \| `deep` \| `instant` \| `fast` | `auto` | Exa |
| `ori_question` | string ≤128 chars | — | DeepSeek — original user question |
| `localization` | string | — | DeepSeek — IP used to localize results |

DeepSeek query operators pass through: `site:github.com`, `-site:example.com`, `"exact phrase"`,
`-word`, `lang:zh,en`, `after:2025`, `before:2026-06-01`.

### `fetch`

Pulls full page content, trying providers in order until one returns real text.

| Parameter | Type | Default |
|---|---|---|
| `url` | string | — |
| `urls` | string[] | — |
| `provider` | `both` \| `exa` \| `deepseek` | configured `FETCH_PROVIDER_ORDER` |
| `max_chars` | integer 200–20000 | 6000 |

`both` means "follow the fallback order", not "call both and compare": the first provider that
returns non-empty content wins per URL, so a successful Exa fetch never spends DeepSeek credits.

### `status`

Reports which keys are configured, the default search behaviour and the effective fetch chain.
No network calls, no cost.

---

## What "combine" actually means

When both engines return the same page, you get **one** entry with `sources: ["exa", "deepseek"]`,
not two near-duplicates. URLs are compared after:

- lowercasing the host and dropping the fragment,
- removing tracking parameters (`utm_*`, `ref`, `fbclid`, `gclid`, `mc_cid`, `_hsenc`, …),
- collapsing duplicate slashes and stripping the trailing slash.

The first occurrence keeps its position, so provider ranking is preserved. Missing fields are filled
from the other provider instead of being discarded, and each provider's own snippet is kept when the
two phrase things differently. Set `MERGE_DEDUPE=false` to get the raw concatenation instead.

---

## CLI

The same code path is reachable without an MCP client, which makes debugging a one-liner:

```bash
dxsc status
dxsc search "rust async runtime comparison" --count 5
dxsc search "site:arxiv.org diffusion models" --provider deepseek --count 10
dxsc search "transformer" --content --json
dxsc fetch https://example.com/article --max-chars 8000
```

Run `dxsc --help` for every flag. `--json` prints the structured result instead of Markdown.

---

## Cost

Nothing is cached — two identical calls cost twice.

| Provider | Billing |
|---|---|
| Exa | Per request; roughly $0.007 for a small search. `need_content` and `count` both raise it. |
| DeepSeek | $0.75 / 1,000 successful requests (~$0.00075 each). Failed requests and empty result sets are not billed. |

`fetch` costs one request per provider per URL that actually gets tried, so a working Exa fetch costs
one Exa call and zero DeepSeek calls.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `No API keys configured` on start | Neither `EXA_API_KEY` nor `DEEPSEEK_API_KEY` reached the process |
| `Provider "deepseek" is not configured` | You passed `provider: "deepseek"` with only an Exa key. Omit `provider` to auto-narrow |
| `… failed: HTTP 429 (retryable)` in Notes | Provider rate limit; the other provider's results are still returned |
| Nothing loads in the client on Windows | The launcher could not spawn `npx`. Set `command` to an absolute `node` path |

Exit code is `1` from the CLI when nothing could be retrieved at all; a partial success exits `0`.

---

## Development

```bash
npm test        # 77 tests, node:test, no dependencies
npm run check   # syntax check every module
```

Layout:

```
bin/dxsc.mjs              entry point (MCP by default, CLI for everything else)
src/config.mjs            env parsing + provider resolution
src/http.mjs              single POST helper, error normalisation
src/providers/            exa.mjs, deepseek.mjs, registry + fan-out
src/merge.mjs             cross-provider dedupe and field merging
src/render.mjs            Markdown output
src/tools.mjs             tool schemas + implementations
src/server.mjs            JSON-RPC dispatch (transport agnostic)
src/transports/stdio.mjs  newline-delimited JSON-RPC over stdio
test/                     unit + protocol tests against a fetch double
```

The dispatcher is transport-agnostic and takes an injectable `fetchImpl`, so tests exercise the real
protocol and the real provider mapping without network access or a child process.

## License

MIT
