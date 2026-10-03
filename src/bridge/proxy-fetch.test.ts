import net from "node:net"
import { describe, expect, it } from "vitest"

import { createProxiedFetch, resolveProxy } from "./proxy-fetch.ts"
import { listenBridge } from "./server.ts"

describe("outbound proxy", () => {
  it("rejects socks urls", () => {
    expect(() => createProxiedFetch("socks5://127.0.0.1:1080")).toThrow(/http proxy/)
  })

  it("reads --proxy before the environment", () => {
    expect(resolveProxy(["node", "cli", "--proxy", "http://127.0.0.1:7890"], { HTTPS_PROXY: "http://env" })).toBe("http://127.0.0.1:7890")
    expect(resolveProxy(["node", "cli"], { ANTIGRAVITY_PROXY: "http://127.0.0.1:7890" })).toBe("http://127.0.0.1:7890")
  })

  it("sends upstream https through the configured proxy", async () => {
    const seen: string[] = []
    const proxy = net.createServer((socket) => {
      socket.once("data", (chunk) => {
        seen.push(chunk.toString("utf8").split("\r\n")[0] ?? "")
        socket.end()
      })
    })
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", () => resolve()))
    const address = proxy.address()
    if (!address || typeof address === "string") throw new Error("proxy did not bind")
    try {
      const proxied = createProxiedFetch(`http://127.0.0.1:${address.port}`)
      const controller = new AbortController()
      const pending = proxied("https://oauth2.googleapis.com/token", {
        method: "POST",
        signal: controller.signal,
      }).catch(() => undefined)
      const line = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("proxy received no CONNECT")), 1500)
        const check = setInterval(() => {
          const first = seen[0]
          if (!first) return
          clearInterval(check)
          clearTimeout(timer)
          resolve(first)
        }, 20)
      })
      expect(line).toContain("CONNECT oauth2.googleapis.com:443")
      controller.abort()
      await pending
    } finally {
      proxy.closeAllConnections?.()
      await new Promise<void>((resolve) => proxy.close(() => resolve()))
    }
  })
})

describe("bridge health", () => {
  it("reports whether an outbound proxy is enabled and checks the token", async () => {
    const bridge = await listenBridge({
      port: 0,
      token: "local",
      proxyEnabled: true,
      deps: {
        pool: { acquire: () => null, markLimited() {}, unbind() {} },
      },
    })
    try {
      const health = await fetch(`http://127.0.0.1:${bridge.port}/health`)
      expect(await health.json()).toEqual({ ok: true, proxy: true })
      const denied = await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
        body: "{}",
      })
      expect(denied.status).toBe(401)
    } finally {
      await bridge.close()
    }
  })
})
