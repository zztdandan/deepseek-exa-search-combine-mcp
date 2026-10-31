# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-31

First public release.

### Added

- **MCP stdio server** exposing three tools: `search`, `fetch`, `status`.
  Speaks JSON-RPC 2.0 over newline-delimited stdio; supports protocol versions
  `2025-06-18`, `2025-03-26` and `2024-11-05`, echoing whichever the client requests.
- **Combined search.** Queries every configured provider concurrently and merges the
  results: pages returned by more than one engine collapse into a single entry whose
  `sources` array lists all of them. Ranking order from the first provider is preserved
  and missing fields are filled from the later one.
- **URL normalisation for dedupe.** Lowercases the host, drops fragments, strips tracking
  parameters (`utm_*`, `ref`, `fbclid`, `gclid`, `mc_cid`, `_hsenc`, …), collapses
  duplicate slashes and removes the trailing slash. Disable with `MERGE_DEDUPE=false`.
- **Single-provider mode.** With only one API key, `provider: "both"` narrows to that
  provider instead of emitting a failure block. Explicitly requesting an unconfigured
  provider is a clear tool error.
- **Configurable fetch fallback order** via `FETCH_PROVIDER_ORDER` (default `exa,deepseek`).
  The first provider returning non-empty content wins per URL, so a successful Exa fetch
  never spends DeepSeek credits.
- **Independent provider failure.** One backend timing out or rate-limiting never removes
  the other backend's results; failures are reported in a `Notes:` block and `isError` is
  only set when every provider failed.
- **CLI** (`dxsc`) with `serve`, `search`, `fetch`, `status` subcommands and a `--json` mode,
  so the same code path is verifiable without an MCP client.
- **Injectable `fetchImpl` and transport-agnostic dispatcher**, which is what makes the
  test suite run the real protocol and real provider mapping with no network and no child
  process.
- 77 tests covering config resolution, merging, rendering, HTTP error handling, provider
  request/response mapping, tool orchestration and the JSON-RPC layer.

### Design notes

- Zero runtime dependencies; Node built-ins only. `engines.node >= 20`.
- A single shared POST helper normalises every non-2xx response into an `HttpError`
  carrying `status`, `code`, `retryable` and a message extracted from either provider's
  error shape (Exa's `{error, tag}` or DeepSeek's OpenAI-style `{error:{message}}`).
- Snippets are folded to one line and scraped JSX/HTML is trimmed, because both engines
  occasionally return page fragments that would otherwise break the result layout.
- Empty titles fall back to `hostname + pathname` instead of `(untitled)`.
