# src/plugin/recovery

Score 8 (index.ts, code ratio, 44 export lines, symbols over 30). Distinct domain: on-disk session part repair. The in-memory recovery policy stays in ../recovery.ts.

## OVERVIEW
Reads OpenCode message and part files, finds empty or thinking-only turns, and injects or strips parts so a session can resume.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Barrel | index.ts | re-exports types, constants, storage |
| Part types | types.ts | thinking, redacted_thinking, reasoning; text, tool, tool_result |
| Read session | storage.ts | readMessages, readParts |
| Empty turns | storage.ts | findEmptyMessages, replaceEmptyTextParts |
| Thinking-only | storage.ts | findMessagesWithThinkingOnly, findMessagesWithOrphanThinking |
| Inject text | storage.ts | injectTextPart, prependThinkingPart |
| Strip thinking | storage.ts | stripThinkingParts |
| Ids | storage.ts | generatePartId, getMessageDir |

## CONVENTIONS
- ThinkingPartType is thinking, redacted_thinking, or reasoning.
- Storage root is XDG_DATA_HOME or ~/.local/share/opencode/storage, and APPDATA on Windows.
- Callers in ../recovery.ts decide when to repair. This directory only mutates stored parts.

## ANTI-PATTERNS
- Do not treat a thinking-only message as content. messageHasContent is the check.
- Do not delete a session directory from here. These helpers edit parts.
- Do not parse the resume string here. The caller owns the synthetic tool_result text.

## NOTES
- findMessagesWithThinkingBlocks lists assistant messages that still have a thinking part, including ones that also have text. It skips other roles.
- injectTextPart creates the part directory when it is missing. It returns false only when the write throws.
