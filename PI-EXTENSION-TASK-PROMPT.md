# 任务提示词：把 Antigravity OAuth 迁移为 pi / omo-native 扩展（方案 A）

> 用法：把下面 **【主提示词】** 整段复制到新会话作为第一条消息。
> 若新会话报错或走偏，再补 **【附录：已验证的硬事实】** 与 **【附录：已知坑】**。
>
> 本提示词里的"已验证"指的是**在本机上用真实凭据实跑过并拿到 200**的事实，不是推理。

---

## 【主提示词】—— 从这里开始复制

TASK: Port the Antigravity OAuth provider from `~/dev/opencode-antigravity-auth` (my fork:
https://github.com/wedreamer/opencode-antigravity-auth) into a **pi / omo-native extension**, so that
the native (senpi) runtime can use my Google Antigravity account pool as a first-class provider with
`/login`-integrated OAuth — instead of a Gemini API key (which is rate-limited far too hard to be useful).

DELIVERABLE
1. A working pi extension (TypeScript, ESM) developed in the fork at
   `~/dev/opencode-antigravity-auth/packages/pi-extension/` (create that directory inside the fork),
   which calls `pi.registerProvider("google-antigravity", {...})` with a complete `oauth` block.
   It must be **installable by symlink or copy into `~/.senpi/agent/extensions/`**, which is senpi's
   auto-discovery path (global). Project-local is `.senpi/extensions/`.
2. A README in that directory covering: install into senpi, `/login`, and verification.
3. A test file exercising the ported pieces (PKCE, token exchange, URL transform) against mocks,
   plus a documented manual verification procedure against the real backend.

NOTE ON SHAPE: senpi discovers extensions as **`.ts` files/modules in `~/.senpi/agent/extensions/`**
and can hot-reload them with `/reload`. Decide deliberately whether to ship the extension as a
single bundled `.ts` entry (with the fork's logic imported from `dist/`) or to inline the needed
portions; state your choice and why. `senpi -e ./path.ts` exists for quick tests.

SCOPE — the extension must:
- Implement `oauth.login(callbacks)` → PKCE authorize URL + local callback server, returning
  `{ refresh, access, expires }`.
- Implement `oauth.refreshToken(credentials, signal)` → hit `https://oauth2.googleapis.com/token`
  with `grant_type=refresh_token`.
- Implement `oauth.getApiKey(credentials)` → return the access token.
- Register models that match what the Antigravity backend actually serves.
- Reuse the fork's existing, already-debugged logic wherever possible — **do not rewrite from scratch**:
  - `src/antigravity/oauth.ts` — PKCE, authorize URL, token exchange
  - `src/constants.ts` — client id/secret (deliberately split/obfuscated), scopes, endpoint fallbacks, header styles
  - `src/plugin/request.ts` — the URL transform `/v1beta/models/<m>:generateContent` →
    `<endpoint>/v1internal:<action>?alt=sse`, and the header spoofing

VERIFY (each item needs captured evidence, not "should work")
1. `node --input-type=module` script that imports the ported constants and performs a REAL
   `refresh_token` exchange against `https://oauth2.googleapis.com/token` using one account from
   `~/.config/opencode/antigravity-accounts.json` → must print HTTP 200 and `expires_in`.
2. With the resulting access token, `POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`
   with the Antigravity headers → must print HTTP 200.
3. The extension loads in senpi: `omo --list-models google-antigravity` lists the ported models.
4. A real end-to-end turn through the extension:
   `omo -p "Reply with exactly AGY_NATIVE_OK" --model google-antigravity/<a-model> --no-session`
   → prints `AGY_NATIVE_OK`, exit 0.

STOP WHEN: all four VERIFY items have captured output, and the deliverable directory exists with the
extension, its tests, and its README. Report: the file list, the four pieces of captured evidence, and
anything you had to leave unverified with the reason.

CONSTRAINTS
- Do NOT `git commit` or `git push`. Deliver to the working tree only; I review first.
- Do NOT print, log, or commit any refresh token, access token, client secret, or account email.
  When a credential must be referenced, print its length or the literal string REDACTED.
- The fork's `origin` is `JoshRob297/opencode-antigravity-auth` and the push remote is `fork`
  (`wedreamer/...`). Work on `main`; do not push anywhere.
- Keep changes confined to the fork repo. The only files you may touch outside it are
  `~/.omo/agent/models.json`, `~/.omo/omo.jsonc`, and the senpi extension install path
  (`~/.senpi/agent/extensions/`) — each such write must be reported explicitly with what changed and why.
- The fork uses `npm run build` (`tsc -p tsconfig.build.json`) and `npm test` (vitest). Run both
  before claiming the port compiles/passes.
- Read `~/dev/opencode-antigravity-auth/AGENTS.MD` first and follow it.

## 【主提示词】—— 复制到此为止

---

## 【附录：已验证的硬事实】

这些是我在本机用**真实凭据实跑**得到的，新会话可直接采信，不必重新摸索：

1. **号池 refresh token 可用。**
   `POST https://oauth2.googleapis.com/token` + `grant_type=refresh_token` + 插件的
   `ANTIGRAVITY_CLIENT_ID` / `ANTIGRAVITY_CLIENT_SECRET` → **200**，返回真实 `access_token`，
   `expires_in: 3599`。
2. **换出的 token 能打真后端。**
   `POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`，带
   `Authorization: Bearer <access>` + `getAntigravityHeaders()` → **200**，返回账号 tier。
3. **常量在 dist 里可直接 import**（源码里 client id/secret 是拆分混淆的，别手抄）：
   ```js
   const c = await import("~/dev/opencode-antigravity-auth/dist/src/constants.js");
   // c.ANTIGRAVITY_CLIENT_ID (len 73), c.ANTIGRAVITY_CLIENT_SECRET (len 35),
   // c.ANTIGRAVITY_SCOPES, c.ANTIGRAVITY_ENDPOINT_*, c.getAntigravityHeaders()
   ```
   （`dist/src/constants.js` 是构建产物；改动源码后记得 `npm run build` 或直接改 `src/` 并构建。）
4. **号池文件结构**：`~/.config/opencode/antigravity-accounts.json`
   顶层 `{version, activeIndex, activeIndexByFamily, accounts[]}`；
   每个 account 有 `email, refreshToken, enabled, fingerprint, managedProjectId, cachedQuota, rateLimitResetTimes`。
   **本机实况：15 个账号，6 个 `enabled: true`。**
   做多账号轮换时只挑 `enabled === true && refreshToken` 的。
5. **pi 的 provider OAuth 接口确实存在**（`@code-yeongyu/senpi` 的 `docs/custom-provider.md`，
   "OAuth Support" 一节）：`pi.registerProvider(name, { baseUrl, api, models, oauth: { name, login, refreshToken, getApiKey } })`。
   `registerProvider` 有两种签名：`registerProvider(provider: Provider)` 与
   `registerProvider(name: string, config: ProviderConfig)`。
6. **鉴权头是成败关键**（`src/constants.ts` 的 `getAntigravityHeaders()` / `GEMINI_CLI_HEADERS`）：   ```
   User-Agent: Mozilla/5.0 ... Antigravity/<ver> Chrome/... Electron/37.3.1 Safari/537.36
   X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1
   Client-Metadata: {"ideType":"ANTIGRAVITY","platform":"<WINDOWS|MACOS>","pluginType":"GEMINI"}
   ```
   另一套是 gemini-cli 风格（`google-api-nodejs-client/9.15.1` + `PLATFORM_UNSPECIFIED`）。
   **Google 把 `gemini-3.7-flash` / `gemini-3.8-flash` 锁给官方 Antigravity CLI 签名**，
   这正是 fork 的 README 说它修好的问题；不做 header 伪装这两个模型会 404/429。
7. **端点有 fallback 顺序**（daily sandbox → autopush → prod）：
   ```
   https://daily-cloudcode-pa.sandbox.googleapis.com
   https://autopush-cloudcode-pa.sandbox.googleapis.com
   https://cloudcode-pa.googleapis.com
   ```
8. **请求 URL 变换规则**（`src/plugin/request.ts`）：
   `/v1beta/models/<model>:generateContent` → `<endpoint>/v1internal:<action>?alt=sse`
   （流式时 action 为 `streamGenerateContent`）。
9. **本机 AGY 相关策略**（`~/.config/opencode/antigravity.json`）：
   `round-robin` + `pid_offset_enabled` + `switch_on_first_rate_limit` + `performance_first`
   + `request_jitter_max_ms: 400` + `max_rate_limit_wait_seconds: 180` + `soft_quota_threshold_percent: 90`。
   迁移时对齐这套行为。
10. **senpi 的扩展自动发现路径是 `~/.senpi/agent/extensions/`**（全局）或 `.senpi/extensions/`
    （项目级，需信任）。放进去后可用 `/reload` 热加载；`senpi -e ./path.ts` 适合快速试。
    扩展是 **TypeScript 模块**，默认导出 `function (pi: ExtensionAPI) {...}`，
    类型从 `@earendil-works/pi-coding-agent` 引入（见 `docs/extensions.md`）。
11. **在 `docs/custom-provider.md` 的 OAuth 示例里，`registerProvider` 的 `oauth.getApiKey(credentials)`
    返回的就是 access token**；配合 `authHeader: true` 或 provider 自身的鉴权语义生效。

---

## 【附录：已知坑】

1. **native 与 OpenCode 是两个凭据库。**
   OpenCode 读 `~/.local/share/opencode/auth.json`；
   **native 读 `~/.senpi/agent/auth.json`**（本机该文件此前不存在）。
   OAuth provider 的凭据必须落到 **native 的**库里，否则表现为：
   `omo --list-models` 能看到模型，但一发请求就 `No API key found for <provider>`。
   —— 这个坑我在 Command Code 上真实踩过，务必在 VERIFY 第 4 项里覆盖。
2. **`models.json` 的 schema 很严，且失败是"静默整文件失效"。**
   `input` 只接受 `text | image | video`（**`pdf` 会被拒**）；
   `cost` 对象**四个字段全必填**（含 `cacheWrite`）。
   任何一项不合法 → 整个 `models.json` 不生效（会在 `omo --list-models` 顶部打印 Warning）。
3. **`[senpi]` 与 `[native]` 两个键的双运行时冲突（重要）。**
   native 两个都接受（`senpi` 是别名）；但 OpenCode 插件
   `oh-my-openagent@4.19.4` 的 `OmoConfigLayerSchema` 是 `.strict()` 且**只收 `[senpi]`**，
   遇到根键 `[native]` 会**丢弃整个 omo.jsonc**。
   本机已统一为 `[senpi]`——**不要改回 `[native]`**。
4. **不要在 native 的 `[senpi].agents.*` 上写 `prompt_append` 或 `compaction`**：
   native 的 agent schema（`va`，`.strict()`）不含这两键，写了会让整个块被拒。
   （`prompt_append` 是 category-only。）
5. **别用 `models.json` 的 `apiKey: "!cmd"` 硬扛。**
   我验证过它每次请求都能换出 token，但 senpi 明确**不对 `!cmd` 做 TTL/缓存**
   （见 `docs/models.md`），等于每次调用多一次 Google 往返、且无重试层。
   这正是要做方案 A（真 OAuth provider）而不是绕过它的原因。
6. **测试要能失败。**
   我上一轮的校验脚本连中三个自测才能发现的 bug（嵌套 key 漏检、`:high` 后缀误判、
   未知 provider 被静默丢弃）。写测试时确保每个断言在对应实现被破坏时会真的变红，
   并在报告里给出"我把它弄坏、它确实红了"的证据。
7. **完成后不要提交。** 交付到工作区并给出改动清单 + 证据，等我评审。
8. **换行/命令里的 `require(...)` 路径**：本机 `HOME=/home/shubuzuo`，
   `~` 在 node 的 `require` 里不会展开，脚本里一律用 `os.homedir()` 或绝对路径。

---

## 【新会话第一条消息之后，建议的推进顺序】

1. 读 fork 的 `AGENTS.MD` + `README.md` + `src/antigravity/oauth.ts` + `src/constants.ts`，
   先确认"哪些能直接复用、哪些必须改写"（预期：oauth.ts 与 constants.ts 基本可复用，
   `src/plugin/*` 里面向 OpenCode 插件的部分要重写成 pi extension 形态）。
2. 先跑通**【附录：已验证的硬事实】第 1、2 条**的独立脚本（refresh + loadCodeAssist），
   确认凭据链路在你手上也是通的——这是后续一切的地基。
3. 再写扩展骨架，`omo --list-models google-antigravity` 能列出来（此时**允许**还发不出请求）。
4. 再解决凭据落位（坑 #1），跑通 `omo -p ... --model google-antigravity/<model>`。
5. 最后补测试与 README。
