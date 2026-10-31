# DeepSeek × Exa 合并搜索 MCP

一个 stdio 形式的 MCP 服务器：同时查 **DeepSeek** 和 **Exa**，给你的 agent 一份**去重合并后的结果列表**，
而不是两份互相重叠、还要它自己核对的结果。

两家 key 都配可以，只配一家也可以 —— 只配一家时 `"both"` 会自动收敛到那一家，而不是报错半张表。

- **零依赖**：只用 Node 内置的 `fetch` 和 `readline`，没有 `node_modules`。
- **一个进程两家引擎**：`search` 并行发起，两家都命中的页面合并成一条，标注全部来源。
- **故障隔离**：一家限流或挂掉，不影响另一家返回结果。
- **fetch 顺序可配**：默认 Exa 优先，改一个环境变量即可调换。

---

## 为什么需要它

两家官方 MCP 都不做合并：

| 包 | 限制 |
|---|---|
| `exa-mcp-server` | 只有 Exa |
| `deepseek-mcp-server` | **没有独立 search 工具**，`web_search` 是塞在 `create_response` 里的开关，且只有 `deepseek-v4-pro` 生效 |

DeepSeek 在 2026-10-17 开了独立的 Search & Fetch JSON API（`/v1/tools/search`、`/v1/tools/fetch`），
与它的 chat 接口是两套东西。本项目把它当作一等搜索后端，并与 Exa 结果合并。

---

## 安装

```bash
npx -y deepseek-exa-search-combine-mcp
# 或
npm i -g deepseek-exa-search-combine-mcp
dxsc status
```

需要 **Node.js 20+**。

---

## 配置

| 环境变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `EXA_API_KEY` | 二选一 | — | https://dashboard.exa.ai/api-keys |
| `DEEPSEEK_API_KEY` | 二选一 | — | https://platform.deepseek.com/api_keys |
| `DEFAULT_SEARCH_PROVIDER` | 否 | `both` | 调用时没传 `provider` 就用这个 |
| `FETCH_PROVIDER_ORDER` | 否 | `exa,deepseek` | `fetch` 的回落顺序 |
| `SEARCH_HTTP_TIMEOUT_MS` | 否 | `60000` | 单次请求超时 |
| `EXA_BASE_URL` / `DEEPSEEK_BASE_URL` | 否 | 官方地址 | 走代理时覆盖 |
| `MERGE_DEDUPE` | 否 | `true` | 设为 `false` 关闭跨源去重 |

两个 key 一个都没有时服务拒绝启动 —— 零后端的搜索服务器只会在后面更含糊地失败。

### 客户端配置

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "deepseek-exa-search-combine-mcp"],
      "env": {
        "EXA_API_KEY": "你的 exa key",
        "DEEPSEEK_API_KEY": "你的 deepseek key"
      }
    }
  }
}
```

Windows 上如果客户端起不来 `npx`，直接把 `command` 指向绝对路径的 `node`、`args` 指向
`bin/dxsc.mjs`，可以绕开启动器问题。

---

## 工具

### `search`

| 参数 | 类型 | 默认 | 作用域 |
|---|---|---|---|
| `query`（必填） | string | — | 两家 |
| `provider` | `both` \| `exa` \| `deepseek` | `both` | — |
| `count` | 1–100 | 8 | Exa ≤100，DeepSeek ≤50（各自钳制） |
| `need_content` | boolean | false | 两家，附带正文 |
| `max_chars` | 200–20000 | 4000 | 正文截断 |
| `include_domains` / `exclude_domains` | string[] | — | 仅 Exa |
| `start_published_date` / `end_published_date` | ISO 8601 | — | 仅 Exa |
| `category` | company / publication / news / personal site / financial report / people | — | 仅 Exa |
| `type` | auto / lite / deep-lite / deep / instant / fast | auto | 仅 Exa |
| `ori_question` | ≤128 字 | — | 仅 DeepSeek |
| `localization` | string | — | 仅 DeepSeek |

DeepSeek 查询运算符原样透传：`site:`、`-site:`、`"精确短语"`、`-词`、`lang:zh,en`、`after:2025`、`before:2026-06-01`。

### `fetch`

按配置顺序逐个尝试，第一个返回真实正文的胜出。`both` 不等于"两边都调"，
所以 Exa 抓成功时不会消耗 DeepSeek 额度。

### `status`

报告 key 配置、默认搜索策略、实际 fetch 链路。不发请求，不花钱。

---

## "合并"具体做了什么

两家都返回同一页面时，你只会看到**一条**记录，`sources: ["exa","deepseek"]`。URL 比较前会：

- 主机名小写、去掉 fragment；
- 去掉追踪参数（`utm_*`、`ref`、`fbclid`、`gclid`、`mc_cid`、`_hsenc` 等）；
- 合并重复斜杠、去掉末尾斜杠。

先出现的条目保持原位置，因此排序不被破坏；缺失字段用另一家的值补齐而不是丢弃；
两家措辞不同时分别保留自己的摘要。`MERGE_DEDUPE=false` 可关掉这一切。

---

## 命令行

```bash
dxsc status
dxsc search "rust 异步运行时 对比" --count 5
dxsc search "site:arxiv.org diffusion models" --provider deepseek
dxsc search "transformer" --content --json
dxsc fetch https://example.com/article --max-chars 8000
```

---

## 成本

不缓存，同样的问题问两次就是两次计费。

| 提供方 | 计费 |
|---|---|
| Exa | 按请求，单次搜索约 $0.007；`need_content` 和 `count` 会推高 |
| DeepSeek | 每 1000 次成功请求 $0.75（约 $0.00075/次），失败和空结果不计费 |

---

## 排查

| 现象 | 原因 |
|---|---|
| 启动即 `No API keys configured` | 两个 key 都没进到进程环境 |
| `Provider "deepseek" is not configured` | 只配了 Exa 却显式指定了 deepseek；不传 `provider` 就会自动收敛 |
| Notes 里出现 `HTTP 429 (retryable)` | 某家限流，另一家结果照常返回 |
| Windows 客户端加载不了 | 启动器起不来 `npx`，改用绝对 node 路径 |

---

## 开发

```bash
npm test        # 77 个测试，node:test，零依赖
npm run check   # 全模块语法检查
```

`src/server.mjs` 的 dispatcher 与传输无关，且可注入 `fetchImpl`，所以测试能跑真实协议和真实
字段映射，不需要网络也不需要子进程。

## 许可证

MIT
