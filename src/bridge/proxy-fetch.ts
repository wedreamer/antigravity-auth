import { fetch as undiciFetch, ProxyAgent } from "undici"

export function createProxiedFetch(proxyUrl: string): typeof fetch {
  const proxy = proxyUrl.trim()
  if (!proxy) return fetch
  if (proxy.startsWith("socks")) {
    throw new Error("socks proxy is not supported; use an http proxy such as http://127.0.0.1:7890")
  }
  const agent = new ProxyAgent(proxy)
  return async (input, init) => {
    const response = await undiciFetch(input, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
      dispatcher: agent,
    })
    return response as unknown as Response
  }
}

export function resolveProxy(argv = process.argv, env = process.env): string {
  const index = argv.indexOf("--proxy")
  const fromArg = index >= 0 ? argv[index + 1] : undefined
  return (fromArg || env.ANTIGRAVITY_PROXY || env.HTTPS_PROXY || env.https_proxy || "").trim()
}
