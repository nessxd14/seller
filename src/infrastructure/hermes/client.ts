import { supabase } from '../supabase/supabaseClient'

// La credencial de Hermes nunca toca este archivo ni ningún otro que corra en el
// navegador — vive solo en api/hermes/*.ts, del lado del servidor de Vercel. Acá solo
// se llama a esos dos endpoints propios, como a cualquier otro endpoint del POS.

export interface SaldoCliente {
  saldoConfirmado: number
  saldoProvisional: number
  situacion: string | null
  /** true = el cliente no tiene cuenta corriente en Hermes (no está importado). */
  sinCuenta?: boolean
}

export interface CargoRegistrado {
  movimientoId: string
  saldoResultante: number
  cubiertoPorSaldo: boolean
}

export interface PagoRegistrado {
  pagoId: string
  saldoProvisional: number
}

const authHeaders = async (): Promise<HeadersInit> => {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json' }
}

/** Nunca lanza — un fallo de red, de auth, o un cliente no importado a Hermes son
 * indistinguibles acá a propósito: en los tres casos el resultado visual es "no hay
 * badge", nunca un error que el llamador tenga que manejar. */
export async function consultarSaldo(clienteId: number): Promise<SaldoCliente | null> {
  try {
    const response = await fetch('/api/hermes/consultar-saldo', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ clienteId }),
    })
    if (!response.ok) return null
    const data = await response.json()
    return data ?? null
  } catch {
    return null
  }
}

/** A diferencia de consultarSaldo, esta SÍ lanza en caso de fallo — el llamador
 * (registro del cargo al confirmar una venta) necesita saber que falló para encolar el
 * reintento en pendiente_sync_hermes. Una respuesta exitosa es siempre éxito, sea la
 * primera llamada o un reintento de la misma venta — la idempotencia ya la garantiza
 * la RPC del lado de Hermes. */
export async function registrarCargoSaldo(input: { clienteId: number; monto: number; ventaId: string | number; usuarioPos: string }): Promise<CargoRegistrado> {
  const response = await fetch('/api/hermes/registrar-cargo', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error((data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) || 'No se pudo registrar el cargo en Hermes')
  return data as CargoRegistrado
}

/** Mismo contrato que registrarCargoSaldo — SÍ lanza en caso de fallo, el llamador
 * (PagoModal) necesita saberlo para encolar el reintento en pendiente_sync_hermes_pago.
 * El PROPUESTO/confirmación en Hermes es cosa de supervisores en otra app: acá no hay
 * nada que interpretar sobre ese estado, solo éxito (se pudo proponer) o fallo (se encola). */
export async function registrarPago(input: { clienteId: number; monto: number; medio: string; pedidoId?: string | number; movimientoCajaId: string | number; usuarioPos: string }): Promise<PagoRegistrado> {
  const response = await fetch('/api/hermes/registrar-pago', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error((data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) || 'No se pudo registrar el pago en Hermes')
  return data as PagoRegistrado
}
