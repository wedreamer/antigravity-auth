import { fetch as undiciFetch, ProxyAgent, type BodyInit as UndiciBodyInit, type RequestInit as UndiciRequestInit } from "undici"

function pairsFromForEach(headers: { forEach(callback: (value: string, name: string) => void): void }): [string, string][] {
  const pairs: [string, string][] = []
  headers.forEach((value, name) => {
    pairs.push([name, value])
  })
  return pairs
}

function headerPairs(headers: HeadersInit): [string, string][] {
  if (Array.isArray(headers)) return headers.map(([name, value]) => [name, String(value)])
  if (headers instanceof Headers) return pairsFromForEach(headers)
  return Object.entries(headers)
}

function undiciTarget(input: RequestInfo | URL): string | URL {
  if (typeof input === "string" || input instanceof URL) return input
  return input.url
}

function undiciBody(body: BodyInit | null | undefined): UndiciBodyInit | undefined {
  if (body == null) return undefined
  if (typeof body === "string" || body instanceof URLSearchParams || body instanceof ArrayBuffer || body instanceof Uint8Array) {
    return body
  }
  return undefined
}

function undiciInitFrom(input: RequestInfo | URL, init: RequestInit | undefined, agent: ProxyAgent): UndiciRequestInit {
  const request = typeof input === "string" || input instanceof URL ? undefined : input
  const headers = init?.headers ?? request?.headers
  return {
    method: init?.method ?? request?.method,
    headers: headers ? headerPairs(headers) : undefined,
    body: undiciBody(init?.body ?? request?.body),
    signal: init?.signal ?? request?.signal,
    dispatcher: agent,
  }
}

async function toFetchResponse(response: Awaited<ReturnType<typeof undiciFetch>>): Promise<Response> {
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: pairsFromForEach(response.headers),
  })
}

export function createProxiedFetch(proxyUrl: string): typeof fetch {
  const proxy = proxyUrl.trim()
  if (!proxy) return fetch
  if (proxy.startsWith("socks")) {
    throw new Error("socks proxy is not supported; use an http proxy such as http://127.0.0.1:7890")
  }
  const agent = new ProxyAgent(proxy)
  return async (input, init) => {
    const response = await undiciFetch(undiciTarget(input), undiciInitFrom(input, init, agent))
    return toFetchResponse(response)
  }
}

export function resolveProxy(argv = process.argv, env = process.env): string {
  const index = argv.indexOf("--proxy")
  const fromArg = index >= 0 ? argv[index + 1] : undefined
  return (fromArg || env.ANTIGRAVITY_PROXY || env.HTTPS_PROXY || env.https_proxy || "").trim()
}
