let proxyInitialized = false

export async function setProxy() {
    if (proxyInitialized || !process.env.PROXY_URL) return
    proxyInitialized = true

    const { setGlobalDispatcher, ProxyAgent } = await import("undici")
    setGlobalDispatcher(new ProxyAgent(process.env.PROXY_URL))
  }

export async function fetchDirect(url: string | URL, init?: RequestInit): Promise<Response> {
    const { Agent } = await import("undici")
    return fetch(url, { ...init, dispatcher: new Agent() } as RequestInit)
  }