# PROJECT KNOWLEDGE BASE

**Generated:** 2026-10-03
**Commit:** 51908e3
**Branch:** main

## OVERVIEW
OpenCode plugin that rewrites Gemini-shaped fetches into Antigravity Cloud Code requests. One TypeScript account pool serves OpenCode, omo, and the AstrBot bridge. Zod 4, Vitest, ESM.

## STRUCTURE
```
./
├── index.ts              # v2 entry: setupV2
├── src/plugin.ts         # v1 fetch interceptor, 3526 lines
├── src/constants.ts      # endpoints, client id, headers
├── src/plugin/           # auth, quota, request, transform
├── src/bridge/           # OpenAI-compatible local bridge
├── src/v2/               # OpenCode v2 session hooks
├── src/hooks/            # startup auto-update checker
├── src/antigravity/      # OAuth PKCE + token exchange
└── astrbot_plugin_antigravity/  # submodule; protocol stays in this repo
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| v1 intercept | src/plugin.ts | createAntigravityPlugin, fetch rewrite |
| v2 hooks | src/v2/adapter.ts | setupV2; only caller is index.ts |
| Request rewrite | src/plugin/request.ts | prepareAntigravityRequest, 1993 lines |
| Schema / thinking strip | src/plugin/request-helpers.ts | deepFilterThinkingBlocks, 2935 lines |
| Session recovery | src/plugin/recovery.ts | synthetic tool_result; disk helpers in recovery/ |
| Quota / rotation | src/plugin/quota.ts, rotation.ts | 5h and weekly windows |
| Accounts | src/plugin/accounts.ts | 1404 lines; refreshToken\|projectId\|managedProjectId |
| OAuth | src/antigravity/oauth.ts | authorizeAntigravity, exchangeAntigravity |
| OpenAI bridge | src/bridge/server.ts | listenBridge, handleRequest |
| Model transform | src/plugin/transform/ | claude.ts, gemini.ts, model-resolver.ts |
| Streaming | src/plugin/core/streaming/ | transformer.ts; one as any, do not copy |
| Config | src/plugin/config/loader.ts | antigravity.json merge |
| Auto-update | src/hooks/auto-update-checker/ | session.created hook |
| Architecture prose | docs/ARCHITECTURE.md | not an export surface |
| API spec | docs/ANTIGRAVITY_API_SPEC.md | gateway reference |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| setupV2 | function | src/v2/adapter.ts | v2 plugin entry |
| createAntigravityPlugin | function | src/plugin.ts | v1 plugin factory |
| authorizeAntigravity | function | src/antigravity/oauth.ts | PKCE authorize URL |
| exchangeAntigravity | function | src/antigravity/oauth.ts | code + state exchange |
| listenBridge | function | src/bridge/server.ts | local OpenAI server |
| prepareAntigravityRequest | function | src/plugin/request.ts | outbound rewrite |
| transformAntigravityResponse | function | src/plugin/request.ts | inbound rewrite |
| resolveModelWithTier | function | src/plugin/transform/model-resolver.ts | model + thinking tier |
| loadConfig | function | src/plugin/config/loader.ts | merged antigravity.json |
| createAutoUpdateCheckerHook | function | src/hooks/auto-update-checker | startup pin rewrite |

## CONVENTIONS
- Double quotes and named exports are the common style.
- Semicolons and extensionless relative imports are the norm in src/plugin.ts, src/plugin, src/hooks, src/v2, and src/antigravity. Do not treat "no semicolons + .ts extensions" as the repo rule.
- index.ts imports with .js specifiers (./src/plugin.js, ./src/v2/adapter.js).
- zod ^4. Tests are colocated *.test.ts (Vitest).
- ESLint flat config (`eslint.config.js`) uses `typescript-eslint` strict. `npm run lint` must pass. Biome is not used. Do not globally turn off `no-explicit-any` or `no-unused-vars`. `no-undef` stays off because TypeScript already checks names.
- createLogger("module") before TUI app.log.

## ANTI-PATTERNS (THIS PROJECT)
- Do not reimplement the protocol in astrbot_plugin_antigravity.
- Do not land omo or AstrBot features on branch upstream-sync.
- quota_fallback is deprecated and ignored. Gemini always falls back between Antigravity and Gemini CLI quotas.
- Do not persist a weekly or 5h Retry-After as an RPM cooldown. Cap non-quota waits at 60s.
- Do not copy the as any in src/plugin/core/streaming/transformer.ts.
- Do not copy empty catch blocks from src/v2/adapter.ts into new code.

## UNIQUE STYLES
- Refresh string is refreshToken|projectId|managedProjectId. Keep empty segments.
- Fingerprint contributes User-Agent only. History cap 5.
- Outgoing Claude thinking blocks are stripped. Recovery injects a synthetic tool_result.

## COMMANDS
```bash
npm install
npm run build
npm run typecheck
npm run lint
npm test
npx vitest run src/plugin/auth.test.ts
npm run bridge
npm run pack:astrbot
```

## NOTES
- .codegraph is present. Use it before a broad grep.
- Config merge: schema defaults, then antigravity.json, then project .opencode/antigravity.json.
- Windows paths split: loader uses XDG or ~/.config/opencode; some debug paths use %APPDATA%.
- index.ts default export has setup() for v2 (setupV2) and server() for v1 (AntigravityCLIOAuthPlugin).
- Child maps: src/plugin/AGENTS.md, src/plugin/transform/AGENTS.md, src/plugin/config/AGENTS.md, src/plugin/recovery/AGENTS.md, src/bridge/AGENTS.md, src/hooks/auto-update-checker/AGENTS.md.
- Root knowledge file stays `AGENTS.MD`. Do not rename it to `AGENTS.md`.
- `src/plugin.ts`, `src/plugin/request.ts`, and `src/plugin/request-helpers.ts` stay unsplit.
- Node engine is `>=24.11.0`, the `lts/krypton` line. `.nvmrc` is `lts/krypton`. CI and release use that alias. `@types/node` tracks 24.
- TypeScript stays on 5.9. `typescript-eslint@8.71` peers `<6.1.0`, so TypeScript 7 is not the toolchain yet. undici is 8 because Node 24 satisfies its `>=22.19` engine.
- `npm run typecheck` covers `index.ts` and `script/*.ts`. `noUnusedLocals` and `noUnusedParameters` are on. `exactOptionalPropertyTypes` stays off until that error set is cleared on its own.
- `lib` keeps `DOM` because `RequestInfo`, `HeadersInit`, and `BodyInit` come from that lib. `jsx` is unset; the repo has no TSX.
