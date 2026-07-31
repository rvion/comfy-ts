/** pure url layer for ComfyHost: parse once, render everywhere. No comfyts global. */

export type ParsedHostBase = {
   scheme: 'http' | 'https'
   host: string
   /** always concrete (defaults 80/443 from the scheme when the url omits it) */
   port: number
   /** '' or '/segment…' with no trailing slash */
   basePath: string
}

/** exactly ONE of `url` or the legacy `host`+`port` (+`https?`) spelling */
export function parseHostBase(p: {
   id: string
   url?: string
   host?: string
   port?: number
   https?: boolean
}): ParsedHostBase {
   const hasLegacy = p.host != null || p.port != null || p.https != null
   if (p.url != null && hasLegacy)
      throw new Error(`host '${p.id}': give either url OR host/port/https, not both spellings at once`)
   if (p.url == null) {
      if (p.host == null || p.port == null)
         throw new Error(`host '${p.id}': needs either url, or host AND port (got host=${p.host}, port=${p.port})`)
      return { scheme: p.https ? 'https' : 'http', host: p.host, port: p.port, basePath: '' }
   }

   let parsed: URL
   try {
      parsed = new URL(p.url)
   } catch {
      throw new Error(`host '${p.id}': unparseable url '${p.url}'`)
   }
   if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      throw new Error(`host '${p.id}': url scheme must be http or https, got '${parsed.protocol}' in '${p.url}'`)
   if (parsed.search !== '' || parsed.hash !== '')
      throw new Error(`host '${p.id}': url must be a plain base (no ?query or #hash), got '${p.url}'`)
   const scheme = parsed.protocol === 'https:' ? 'https' : 'http'
   const port = parsed.port !== '' ? Number(parsed.port) : scheme === 'https' ? 443 : 80
   const basePath = parsed.pathname.replace(/\/+$/, '')
   return { scheme, host: parsed.hostname, port, basePath }
}

/** http(s) base, port omitted when it is the scheme default */
export function renderHttpBase(p: ParsedHostBase): string {
   return `${p.scheme}://${p.host}${renderPort(p)}${p.basePath}`
}

/** ws(s) endpoint; auth rides the upgrade headers — EXCEPT headerless
 * transports (browser), where the ws client remaps X-API-Key to ?token= */
export function renderWsUrl(p: ParsedHostBase): string {
   const scheme = p.scheme === 'https' ? 'wss' : 'ws'
   return `${scheme}://${p.host}${renderPort(p)}${p.basePath}/ws`
}

function renderPort(p: ParsedHostBase): string {
   const schemeDefault = p.scheme === 'https' ? 443 : 80
   return p.port === schemeDefault ? '' : `:${p.port}`
}
