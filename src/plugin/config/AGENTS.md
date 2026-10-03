# src/plugin/config

Score 8 (index.ts, code ratio, 41 export lines, symbols over 30). Distinct domain: antigravity.json merge. Parent owns account rotation.

## OVERVIEW
Loads and validates plugin config, publishes the OpenCode model list, and writes the quota and update command files.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Merge | loader.ts | loadConfig(directory) |
| Paths | loader.ts | getUserConfigPath, getProjectConfigPath |
| Schema | schema.ts | AntigravityConfigSchema, DEFAULT_CONFIG; 546 lines |
| Strategies | schema.ts | account default hybrid; scheduling default balance |
| Model list | models.ts | OPENCODE_MODEL_DEFINITIONS |
| Command files | updater.ts | ensureAntigravityQuotaCommand, updateOpencodeConfig |
| Runtime flag | loader.ts | initRuntimeConfig, getKeepThinking |

## CONVENTIONS
- Merge order is schema defaults, then user antigravity.json, then project .opencode/antigravity.json.
- Bad JSON or a Zod failure logs and skips that file. Deep-merge only signature_cache.
- User path is OPENCODE_CONFIG_DIR, else XDG_CONFIG_HOME or ~/.config/opencode, including on Windows.

## ANTI-PATTERNS
- loadConfig does not apply the env overrides the schema header documents. Do not assume OPENCODE_ANTIGRAVITY_QUIET or KEEP_THINKING change the loaded object.
- quota_fallback is in the schema and ignored. Do not branch on it.
- Do not JSON.parse-roundtrip user JSONC in updater.ts. The command writers preserve comments.

## NOTES
- DEFAULT_CONFIG is the schema object at schema.ts. Tests import it instead of re-stating defaults.
- getKeepThinking reads initRuntimeConfig. Before that call it returns false.
