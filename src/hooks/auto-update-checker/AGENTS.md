# src/hooks/auto-update-checker

Earned this file: score 8 (code ratio, `index.ts` boundary, >10 file-level exports, >30 symbols). Distinct domain: OpenCode plugin self-update, not fetch/auth.

## OVERVIEW
`session.created` hook: compare installed vs npm `latest`, optionally rewrite the user's plugin pin, then wipe OpenCode's package cache.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Hook + toasts | `index.ts` | Sole `src/plugin.ts` import: `createAutoUpdateCheckerHook` |
| Version / pin rewrite | `checker.ts` | JSONC strip, bracket-scan rewrite, dist-tags fetch |
| Cache invalidation | `cache.ts` | `node_modules/<pkg>`, `package.json` dep, `bun.lock` |
| Paths + npm URL | `constants.ts` | `PACKAGE_NAME = "antigravity-auth"`; paths freeze at import |
| Public types | `types.ts` | `UpdateCheckResult`, `AutoUpdateCheckerOptions` |
| Debug log bridge | `logging.ts` | `[auto-update-checker]` → `debugLogToFile` |
| Tests | `*.test.ts` | colocated; mock `node:fs` / `./checker` |

Barrel also re-exports `checkForUpdate`, `getCachedVersion`, `getLatestVersion`, `invalidatePackage`, `invalidateCache`. Plugin does not import those.

## CONVENTIONS
Local deviations from repo defaults:
- Relative imports omit `.ts`; every statement uses a semicolon.
- Dual package match: `antigravity-auth` + legacy `opencode-antigravity-auth`.
- Prerelease (version contains `-`) skips fetch/update.
- `file://` plugin entry → local-dev toast, no npm.
- First top-level `session.created` only (`hasChecked`; skip nested `parentID`).
- `autoUpdate: false` → toast only, no pin rewrite / cache wipe.

## ANTI-PATTERNS (THIS DIRECTORY)
- Never call `invalidateCache` — deprecated alias of `invalidatePackage`.
- Never assume empty `catch` logged a failure — parse/I/O errors return `null`/`false`.
- Never JSON.parse-roundtrip user config — `updatePinnedVersion` preserves JSONC via regex.
- Never treat `constants.ts` as pure — `CACHE_DIR` / user config paths depend on import-time env.
- Never auto-update a prerelease pin.

## COMMANDS
```bash
npx vitest run src/hooks/auto-update-checker/checker.test.ts
npx vitest run src/hooks/auto-update-checker/index.test.ts
npx vitest run -t "prerelease version handling"
```

## NOTES
Wired at `src/plugin.ts` as `createAutoUpdateCheckerHook(client, directory, { showStartupToast: true, autoUpdate: config.auto_update })`.
