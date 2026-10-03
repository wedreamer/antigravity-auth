import { afterEach, describe, expect, it } from "vitest"

import { clearStickyBinding, createStickyState, pickStickyAccount } from "./affinity.ts"
import { listenBridge, type ListeningBridge } from "./server.ts"
import type { AccountPool, PoolAccount } from "./types.ts"

const REFRESH_ONE = "fixture-refresh-token-one"
const REFRESH_TWO = "fixture-refresh-token-two"

function account(id: string, refreshToken: string): PoolAccount {
  return {
    id,
    refreshToken,
    projectId: "test-project",
  }
}

function poolOf(accounts: PoolAccount[], limited: string[]): AccountPool {
  let index = 0
  return {
    acquire() {
      const next = accounts[index]
      index += 1
      return next ?? null
    },
    markLimited(account) {
      limited.push(account.id)
    },
    unbind() {},
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("bridge server", () => {
  const open: ListeningBridge[] = []

  afterEach(async () => {
    await Promise.all(open.splice(0).map((bridge) => bridge.close()))
  })

  it("rewrites a user message to the antigravity endpoint and hides the refresh token", async () => {
    const urls: string[] = []
    const bridge = await listenBridge({
      port: 0,
      deps: {
        pool: poolOf([account("a", REFRESH_ONE)], []),
        refresh: async () => "test-access-token",
        fetchImpl: async (input) => {
          urls.push(String(input))
          return jsonResponse({})
        },
        transform: async () => jsonResponse({
          candidates: [{ content: { parts: [{ text: "pong" }] } }],
        }),
      },
    })
    open.push(bridge)

    const response = await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer local",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        messages: [{ role: "user", content: "Reply with the single word pong" }],
      }),
    })
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain("pong")
    expect(body).not.toContain(REFRESH_ONE)
    expect(urls[0]).toContain("v1internal:generateContent")
  })

  it("returns 200 from the second account when the first upstream response is 429", async () => {
    const limited: string[] = []
    let calls = 0
    const bridge = await listenBridge({
      port: 0,
      deps: {
        pool: poolOf([
          account("first", REFRESH_ONE),
          account("second", REFRESH_TWO),
        ], limited),
        refresh: async () => "test-access-token",
        fetchImpl: async () => {
          calls += 1
          if (calls === 1) return jsonResponse({ error: "rate limited" }, 429)
          return jsonResponse({})
        },
        transform: async () => jsonResponse({
          candidates: [{ content: { parts: [{ text: "pong" }] } }],
        }),
      },
    })
    open.push(bridge)

    const response = await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer local",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        messages: [{ role: "user", content: "ping" }],
      }),
    })
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(calls).toBe(2)
    expect(limited).toEqual(["first"])
    expect(body).toContain("pong")
    expect(body).not.toContain(REFRESH_ONE)
    expect(body).not.toContain(REFRESH_TWO)
  })

  it("emits sse data lines and [DONE] when stream is true", async () => {
    const bridge = await listenBridge({
      port: 0,
      deps: {
        pool: poolOf([account("a", REFRESH_ONE)], []),
        refresh: async () => "test-access-token",
        fetchImpl: async () => jsonResponse({}),
        transform: async () => jsonResponse({
          candidates: [{ content: { parts: [{ text: "pong" }] } }],
        }),
      },
    })
    open.push(bridge)

    const response = await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer local",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        stream: true,
        messages: [{ role: "user", content: "ping" }],
      }),
    })
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(body).toContain("data:")
    expect(body).toContain("data: [DONE]")
    expect(body).not.toContain(REFRESH_ONE)
  })

  it("keeps one session on the same account and assigns the next session another account", async () => {
    const state = createStickyState()
    const accounts = [account("a", REFRESH_ONE), account("b", REFRESH_TWO)]
    const chosen: string[] = []
    const bridge = await listenBridge({
      port: 0,
      deps: {
        pool: {
          acquire(sessionKey) {
            const picked = pickStickyAccount(state, sessionKey, accounts)
            if (picked) chosen.push(`${sessionKey}:${picked.id}`)
            return picked
          },
          markLimited() {},
          unbind(sessionKey) {
            clearStickyBinding(state, sessionKey)
          },
        },
        refresh: async () => "test-access-token",
        fetchImpl: async () => jsonResponse({}),
        transform: async () => jsonResponse({
          candidates: [{ content: { parts: [{ text: "pong" }] } }],
        }),
      },
    })
    open.push(bridge)

    const post = (sessionId: string) => fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer local",
        "Content-Type": "application/json",
        "x-session-id": sessionId,
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        messages: [{ role: "user", content: "ping" }],
      }),
    })

    const first = await post("chat-1")
    const repeat = await post("chat-1")
    const other = await post("chat-2")
    expect(first.status).toBe(200)
    expect(first.headers.get("x-antigravity-account")).toBe("a")
    expect(repeat.headers.get("x-antigravity-account")).toBe("a")
    expect(other.headers.get("x-antigravity-account")).toBe("b")
    expect(chosen).toEqual(["chat-1:a", "chat-1:a", "chat-2:b"])
    expect(await first.text()).not.toContain(REFRESH_ONE)
    await repeat.text()
    await other.text()
  })
})
