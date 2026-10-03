# src/plugin/transform

Score 8 (index.ts, code ratio, 68 export lines, symbols over 30). Distinct domain: model-family request shaping. Parent owns quota and the fetch intercept.

## OVERVIEW
Turns a requested model id into an Antigravity backend model plus thinking and tool payload. No network calls live here.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Resolve id + tier | model-resolver.ts | resolveModelWithTier; 468 lines |
| Gemini 3.5-3.8 backends | model-resolver.ts | resolveAntigravityGemini3{5,6,7,8}FlashBackendModel |
| Header style | model-resolver.ts | resolveModelForHeaderStyle, resolveModelWithVariant |
| Claude payload | claude.ts | applyClaudeTransforms, buildClaudeThinkingConfig |
| Gemini payload | gemini.ts | applyGeminiTransforms, toGeminiSchema; 578 lines |
| Cross-model scrub | cross-model-sanitizer.ts | stripClaudeThinkingFields, stripGeminiThinkingMetadata |
| Shared types | types.ts | ModelFamily, ThinkingTier, ResolvedModel |

## CONVENTIONS
- Two getModelFamily functions exist. model-resolver returns claude \| gemini-flash \| gemini-pro. The sanitizer returns claude \| gemini \| unknown. Do not merge them.
- THINKING_TIER_BUDGETS and GEMINI_3_THINKING_LEVELS live in model-resolver.ts.
- Barrel is index.ts. Import from the directory, not a deep file, unless a test already does otherwise.

## ANTI-PATTERNS
- Do not send Claude thinking fields to a Gemini backend. Use the sanitizer, not a hand-rolled delete.
- Do not invent a backend model id. Add it next to the existing resolveAntigravityGemini3* helpers.

## NOTES
- Entry points are applyClaudeTransforms and applyGeminiTransforms. Tests call those, not the private builders.
- gemini.ts is 578 lines. model-resolver.ts is 468. Both are the hotspots in this directory.
