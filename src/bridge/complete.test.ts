import { describe, expect, it } from "vitest"

import { BridgeError, completeChat } from "./complete.ts"
import type { AccountPool, PoolAccount } from "./types.ts"

function account(): PoolAccount {
  return {
    id: "a",
    refreshToken: "fixture-refresh-token",
    projectId: "test-project",
  }
}

function pool(): AccountPool {
  const accounts = [account()]
  let index = 0
  return {
    acquire() {
      const next = accounts[index]
      index += 1
      return next ?? null
    },
    markLimited() {},
    unbind() {},
  }
}

const request = {
  model: "gemini-3.8-flash",
  messages: [{ role: "user", content: "搜一下真性有为空" }],
}

async function capture(fetchImpl: typeof fetch): Promise<unknown> {
  return completeChat(request, "session", {
    pool: pool(),
    refresh: async () => "test-access-token",
    fetchImpl,
  }).then(() => {
    throw new Error("expected BridgeError")
  }, (caught: unknown) => caught)
}

describe("completeChat upstream errors", () => {
  it("includes error.message when upstream returns 400 JSON", async () => {
    const error = await capture(async () => new Response(
      JSON.stringify({ error: { message: "Proto field is not repeating, cannot start list." } }),
      { status: 400, headers: { "content-type": "application/json" } },
    ))
    expect(error).toBeInstanceOf(BridgeError)
    if (!(error instanceof BridgeError)) return
    expect(error.status).toBe(400)
    expect(error.errorType).toBe("api_error")
    expect(error.message).toContain("upstream status 400")
    expect(error.message).toContain("Proto field is not repeating, cannot start list.")
  })

  it("keeps the status prefix when the 400 body is not JSON", async () => {
    const error = await capture(async () => new Response("not-json", { status: 400 }))
    expect(error).toBeInstanceOf(BridgeError)
    if (!(error instanceof BridgeError)) return
    expect(error.status).toBe(400)
    expect(error.message).toContain("upstream status 400")
  })
})
