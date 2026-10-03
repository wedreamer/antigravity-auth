# src/bridge

Score 4 by the matrix (11 files, 28 export lines, no index.ts). Kept because this directory is a protocol boundary: OpenAI in, Gemini-shaped body out. Parent owns repo commands and the account-pool policy.

## OVERVIEW
AstrBot and other OpenAI clients call this process. It loads a pool, refreshes one access token, and translates the chat body. It does not own OAuth or quota windows.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| HTTP server | server.ts | listenBridge, handleRequest |
| Chat completion | complete.ts | completeChat, BridgeError |
| OpenAI shape | openai.ts | toGeminiBody, normalizeModel, BRIDGE_MODELS |
| Stream chunk | openai.ts | openAIChunk; non-stream is openAICompletion |
| URL | openai.ts | geminiUrl(model, stream) |
| Pool load | pool.ts | loadAccountPool, refreshAccessToken |
| Session stickiness | affinity.ts | pickStickyAccount, clearStickyBinding |
| Outbound proxy | proxy-fetch.ts | createProxiedFetch, resolveProxy |
| CLI | cli.ts | npm run bridge |
| Wire types | types.ts | ChatRequest, PoolAccount, AccountPool, CompletionResult |

## CONVENTIONS
- Call order is handleRequest, then completeChat, then pool refresh, then toGeminiBody.
- Model ids are normalized before the Gemini body is built.
- Sticky binding is in-memory. clearStickyBinding drops one session key.

## ANTI-PATTERNS
- Do not reimplement token refresh or rotation here. Call the pool helpers.
- Do not add a second protocol implementation under astrbot_plugin_antigravity.
- Do not persist sticky bindings. They die with the process.
- Proxy comes from argv or env via resolveProxy. Do not hardcode a proxy URL.
