import { homedir } from "node:os"
import { resolve } from "node:path"

import { listenBridge } from "./server.ts"
import { loadAccountPool } from "./pool.ts"
import { createProxiedFetch, resolveProxy } from "./proxy-fetch.ts"

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value || fallback
}

const port = Number(flag("--port", "18765"))
const host = flag("--host", "127.0.0.1")
const token = flag("--token", "local")
const proxy = resolveProxy()
const accounts = flag(
  "--accounts",
  resolve(homedir(), ".config/opencode/antigravity-accounts.json"),
)

if (!Number.isInteger(port) || port <= 0) {
  console.error("invalid --port")
  process.exit(1)
}

try {
  const fetchImpl = proxy ? createProxiedFetch(proxy) : fetch
  const pool = await loadAccountPool(accounts)
  const bridge = await listenBridge({
    port,
    host,
    token,
    proxyEnabled: proxy.length > 0,
    deps: { pool, fetchImpl },
  })
  console.log(`antigravity bridge listening on http://${host}:${bridge.port}`)
} catch (error) {
  const message = error instanceof Error ? error.message : "failed to start"
  console.error(message)
  process.exit(1)
}
