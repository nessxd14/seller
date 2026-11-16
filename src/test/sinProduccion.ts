// Guarda de pruebas: cualquier fetch hacia un host de Supabase real falla en voz alta.
const HOSTS_PROHIBIDOS = ['.supabase.co', '.supabase.in']

function urlDe(entrada: RequestInfo | URL): string {
  if (typeof entrada === 'string') return entrada
  if (entrada instanceof URL) return entrada.href
  return entrada.url
}

function esSupabaseReal(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return HOSTS_PROHIBIDOS.some((sufijo) => host.endsWith(sufijo))
  } catch {
    return false
  }
}

const fetchOriginal = globalThis.fetch

globalThis.fetch = async function fetchSinProduccion(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = urlDe(entrada)
  if (esSupabaseReal(url)) throw new Error('Test intentó llamar a Supabase real: ' + url)
  return fetchOriginal.call(globalThis, entrada, init)
} as typeof fetch
