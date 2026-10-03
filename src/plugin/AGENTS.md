# src/plugin

Score 11 (files 85, subdirs 7, code ratio, 432 export lines). Distinct domain, so this file exists. Not over 15: no index.ts and no own config. Parent owns repo commands.

## OVERVIEW
Account pool, quota rotation, request rewrite, and config for the Antigravity fetch path. src/plugin.ts (3526 lines) is the v1 interceptor and lives beside this directory, not inside it.

## STRUCTURE
```
src/plugin/
├── transform/        # own AGENTS.md; claude, gemini, model-resolver
├── config/           # own AGENTS.md; loader, schema, models
├── recovery/         # own AGENTS.md; disk session-part repair
├── core/streaming/   # transformer.ts; score 6, no own file
├── cache/            # signature-cache.ts, 480 lines
├── stores/           # signature-store.ts
└── ui/               # auth menu, prompts
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Auth + refresh | auth.ts, token.ts | 60s expiry buffer |
| Pool | accounts.ts | 1404 lines; markAccountUsed after success |
| Quota groups | quota.ts | 649 lines; claude, gemini-pro, gemini-flash |
| Rotation | rotation.ts | 478 lines; account default hybrid; scheduling default balance |
| Schema clean | request-helpers.ts | 2935 lines; allowlist drop of const, $ref, $defs |
| Request body | request.ts | 1993 lines; prepareAntigravityRequest |
| Thinking recovery | thinking-recovery.ts | turn-boundary detection |
| Fingerprint | fingerprint.ts | User-Agent only |
| Debug | debug.ts | 524 lines; file logs, not the TUI logger |
| Storage | storage.ts | 790 lines |

## CONVENTIONS
- Most files here use semicolons and extensionless relative imports. That is the local deviation from the repo rule.
- Named exports are the norm. Do not add a default export.
- Account selection default is hybrid. Scheduling default is balance, not cache_first.

## ANTI-PATTERNS
- Hybrid selection writes selected.lastUsed in getCurrentOrNextForFamily. markAccountUsed writes it again after a successful request. Do not assume selection leaves lastUsed untouched.
- Soft-quota wait needs a model to split pro vs flash. Missing model returns null.
- Do not persist a weekly or 5h Retry-After as an RPM cooldown.
