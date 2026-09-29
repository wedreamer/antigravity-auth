# Antigravity OAuth for senpi / omo-native

A pi extension that registers the `google-antigravity` provider, so the native (senpi) runtime can
use a Google Antigravity account pool as a first-class provider with `/login`-integrated OAuth —
instead of a Gemini API key, which is rate-limited far too hard to be useful.

This package shares its core with the OpenCode plugin in this same repository. Where the plugin's
internals can be imported they are; the OAuth flow is adapted to senpi's credential contract. See
"Relationship to the OpenCode plugin" below.

## Install

senpi auto-discovers extensions in its agent directory. With `omo`, that directory is `~/.omo/agent`:

```bash
ln -sfn "$(pwd)" ~/.omo/agent/extensions/antigravity-auth
```

A stock senpi install uses `~/.senpi/agent/extensions/`. Both spellings resolve to the same
directory on an omo-managed machine, and either one works:

```bash
ln -sfn "$(pwd)" ~/.senpi/agent/extensions/antigravity-auth
```

Then reload with `/reload` inside a session, or verify from the shell:

```bash
omo --list-models google-antigravity
```

Seven models are registered: Gemini 3.8 / 3.7 / 3.6 / 3.5 Flash, Gemini 3.1 Pro, Claude Sonnet 4.6
and Claude Opus 4.6 Thinking.

## Login

```
/login google-antigravity
```

The extension opens the Google consent page, listens on `http://localhost:51121/oauth-callback` for
the redirect, exchanges the code (PKCE, `S256`), resolves the managed project id through
`loadCodeAssist`, and stores `{ type, access, refresh, expires }` under the `google-antigravity` key
of the agent's `auth.json` with mode `600`.

The stored `refresh` value keeps the repository's packed format, `"<refreshToken>|<projectId>"`, so a
credential created on either host keeps working on the other.

## Verify

```bash
omo -p "Reply with exactly AGY_NATIVE_OK" --model google-antigravity/antigravity-gemini-3.8-flash --no-session
```

Prints `AGY_NATIVE_OK` and exits 0.

## How the Antigravity backend behaves

These were established by measurement against the live service, not from documentation. They are the
reason this adapter looks the way it does.

- **Endpoint.** The daily sandbox (`daily-cloudcode-pa.sandbox.googleapis.com`) serves these
  requests; the production host answered the same payload with `403 VALIDATION_REQUIRED` or
  `429 RESOURCE_EXHAUSTED`. Those responses are not real quota exhaustion.
- **Model names.** Gemini Flash models require a tier suffix. `gemini-3.8-flash` returns
  `404 Requested entity was not found`; `gemini-3.8-flash-low|medium|high` is served. Resolution goes
  through the same `resolveAntigravity*FlashBackendModel` helpers the plugin uses.
- **User-Agent.** `gemini-3.7`/`3.8` Flash are only served to the official CLI signature
  (`antigravity/cli/…`). Any other User-Agent is rejected.
- **Request headers.** Antigravity mode sends `Authorization`, `Content-Type`, `Accept` and
  `User-Agent` — deliberately no `X-Goog-Api-Client` and no `Client-Metadata`. The ide type travels in
  the body metadata instead.
- **Request envelope.** The body is `{ project, model, request: { contents, tools, systemInstruction,
  sessionId }, requestType: "agent", userAgent: "antigravity", requestId: "agent-<uuid>" }`.
- **Tool schemas.** Google rejects JSON-Schema keywords such as `const`, `$ref`, `$defs`, `optional`.
  Tool parameters pass through `cleanJSONSchemaForAntigravity`, the shared cleaner, before the request
  goes out.

## Tests

```bash
npx vitest run packages/pi-extension
```

Covers the OAuth flow (the authorize URL and its PKCE `S256` challenge, the `authorization_code`
exchange, the `refresh_token` grant, project discovery, and a full login driven through the real local
callback listener), the SSE → event-union translation (`runTurn`, including the error and abort
terminals), the system-instruction composition, message conversion for multi-turn text, tool calls,
tool results and images, tool-schema cleaning, the request envelope, the model catalog projection, the
packed-refresh format, credential loading (missing, malformed, and token-less auth files), the
malformed-credential path, and the backend model-name mapping.

`test-support/pi-ai-stub.ts` stands in for `@earendil-works/pi-ai/compat`, which senpi injects when it
loads an extension but which is not resolvable from this repository at typecheck time.

## Relationship to the OpenCode plugin

Shared with the plugin (imported, not copied): the model catalog and its projection, the endpoint and
header constants, `cleanJSONSchemaForAntigravity`, `applyToolPairingFixes` (tool-id assignment for the
Anthropic-served Claude models), `configureClaudeToolConfig`, `resolveModelWithTier` and the
`resolveAntigravity*FlashBackendModel` helpers, and the `parseRefreshParts`/`formatRefreshParts`
credential format.

Adapted rather than shared: the OAuth login and refresh flow (`oauth.ts`) — the plugin's
`authorizeAntigravity`/`exchangeAntigravity` return results shaped for the OpenCode plugin loader,
while this extension must satisfy senpi's `OAuthCredentials` contract, so the flow is re-implemented
against the same constants and endpoints rather than wrapped.

Pool handling: the extension reads the same account pool the plugin manages
(`~/.config/opencode/antigravity-accounts.json`), rotates across enabled accounts through a cursor
persisted next to that file, and falls back to the single `google-antigravity` credential in the
agent's `auth.json` when the pool is absent or empty. A refused account is skipped in favour of the
next pool member, and the whole turn fails only when every account is refused.