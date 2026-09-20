import { validateTlsAddress } from './lan-pairing'

const RECOVERABLE = new Set(['LAN_NETWORK_ERROR', 'LAN_TIMEOUT', 'LAN_TLS_IDENTITY_ERROR'])

export async function recoverLanAddress<T>(base: string, request: (address: string) => Promise<T>,
  discover: () => Promise<{ urls: string[] }>): Promise<{ base: string; response: T }> {
  let failure: unknown
  try { return { base, response: await request(base) } }
  catch (error) {
    if (!RECOVERABLE.has(String((error as { code?: unknown })?.code))) throw error
    failure = error
  }
  let urls: string[]
  try { urls = (await discover()).urls } catch { throw failure }
  if (!Array.isArray(urls)) throw failure
  const seen = new Set([base])
  for (const raw of urls.slice(0, 4)) {
    let address: string
    try { address = validateTlsAddress(raw) } catch { continue }
    if (seen.has(address)) continue
    seen.add(address)
    try { return { base: address, response: await request(address) } }
    catch (error) {
      if (!RECOVERABLE.has(String((error as { code?: unknown })?.code))) throw error
    }
  }
  throw failure
}
