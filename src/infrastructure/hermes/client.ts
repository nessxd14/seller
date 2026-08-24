import { supabase } from '../supabase/supabaseClient'

// La credencial de Hermes nunca toca este archivo ni ningún otro que corra en el
// navegador — vive solo en api/hermes/*.ts, del lado del servidor de Vercel. Acá solo
// se llama a esos dos endpoints propios, como a cualquier otro endpoint del POS.

/**
 * Brief S4: antes `consultarSaldo` devolvía `SaldoCliente | null`, donde `null` cubría
 * tres causas bien distintas (sesión vencida, Hermes caído, cliente sin cuenta) — el
 * llamador no podía distinguir "no sé" de "sin cuenta". Ahora un resultado discriminado:
 *   - 'ok'          → hay saldo. saldoConfirmado y saldoProvisional pueden diferir
 *                      mientras el pago está PROPUESTO en Hermes, sin confirmar todavía.
 *   - 'sin-cuenta'  → el cliente no tiene contraparte en Hermes (no es saldo cero).
 *   - 'no-disponible' → sesión vencida, red caída, o Hermes sin configurar. Nunca se debe
 *      mostrar como si fuera "al día" — la UI tiene que decirlo explícitamente.
 */
export type ResultadoSaldo =
  | { estado: 'ok'; saldoConfirmado: number; saldoProvisional: number; situacion: string | null }
  | { estado: 'sin-cuenta' }
  | { estado: 'no-disponible' }

export interface CargoRegistrado {
  movimientoId: string
  saldoResultante: number
  cubiertoPorSaldo: boolean
}

export interface PagoRegistrado {
  pagoId: string
  saldoProvisional: number
}

/**
 * Lleva el status HTTP además del mensaje, para que un llamador (syncHermesCargo) pueda
 * distinguir un 403 (permiso denegado, reintentar nunca va a funcionar) de un fallo de
 * red (sí vale la pena reintentar).
 */
export class HermesHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'HermesHttpError'
  }
}

export interface SaldoClienteLote {
  posClienteId: number
  saldoConfirmado: number
  saldoProvisional: number
  limiteCredito: number | null
  situacion: 'DEUDOR' | 'AL_DIA' | 'ACREEDOR'
}

const authHeaders = async (): Promise<HeadersInit> => {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json' }
}

/** Nunca lanza — pero a diferencia de antes, SÍ distingue "no sé" ('no-disponible': auth
 * vencida, red caída, Hermes sin configurar) de "sin cuenta" (200 + sinCuenta) y de un
 * saldo real. El llamador decide qué mostrar en cada caso; ver ResultadoSaldo. */
export async function consultarSaldo(clienteId: number): Promise<ResultadoSaldo> {
  try {
    const response = await fetch('/api/hermes/consultar-saldo', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ clienteId }),
    })
    if (!response.ok) return { estado: 'no-disponible' }
    const data = await response.json()
    if (data?.sinCuenta) return { estado: 'sin-cuenta' }
    if (!data) return { estado: 'no-disponible' }
    return {
      estado: 'ok',
      saldoConfirmado: Number(data.saldoConfirmado ?? 0),
      saldoProvisional: Number(data.saldoProvisional ?? 0),
      situacion: data.situacion ?? null,
    }
  } catch {
    return { estado: 'no-disponible' }
  }
}

/**
 * Tanda 3: `evaluar_credito_pos` existe en Hermes hace tiempo pero no tenía llamadores —
 * los límites de crédito se configuraban y mostraban en CONCILIADOR pero nunca se
 * aplicaban al vender. Por ahora es solo advertencia (decisión de Ness), mismo patrón de
 * tres estados que ResultadoSaldo: 'ok' con `permitido` en false es lo que dispara el
 * cartel, 'sin-cuenta' y 'no-disponible' no muestran nada — nunca bloquea el submit.
 */
export type ResultadoCredito =
  | { estado: 'ok'; permitido: boolean; saldoConfirmado: number; limiteCredito: number | null; motivoAdvertencia: string | null }
  | { estado: 'sin-cuenta' }
  | { estado: 'no-disponible' }

/** Nunca lanza, mismo criterio que consultarSaldo — el llamador (DraftOrderEditor) solo
 * necesita saber si mostrar el cartel de advertencia, nunca bloquea el submit. */
export async function evaluarCredito(clienteId: number, montoCents: number): Promise<ResultadoCredito> {
  try {
    const response = await fetch('/api/hermes/evaluar-credito', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ clienteId, monto: Math.round(montoCents) / 100 }),
    })
    if (!response.ok) return { estado: 'no-disponible' }
    const data = await response.json()
    if (data?.sinCuenta) return { estado: 'sin-cuenta' }
    if (!data) return { estado: 'no-disponible' }
    return {
      estado: 'ok',
      permitido: data.permitido !== false,
      saldoConfirmado: Number(data.saldoConfirmado ?? 0),
      limiteCredito: data.limiteCredito != null ? Number(data.limiteCredito) : null,
      motivoAdvertencia: data.motivoAdvertencia ?? null,
    }
  } catch {
    return { estado: 'no-disponible' }
  }
}

/**
 * Brief S11 Bloque B4: paso 2 de "eliminar cliente" — hay que saber si el cliente existe
 * en Hermes antes de borrarlo de Cation. Mismo criterio de tres estados que ResultadoSaldo,
 * pero acá 'no-disponible' importa distinto: el llamador (eliminar cliente) lo trata como
 * BLOQUEO, no como "no hay badge" — decisión explícita de Ness, más seguro no borrar que
 * borrar algo que estaba en Hermes.
 */
export type ResultadoVerificarCliente =
  | { estado: 'existe' }
  | { estado: 'no-existe' }
  | { estado: 'no-disponible' }

export async function verificarClienteEnHermes(clienteId: number): Promise<ResultadoVerificarCliente> {
  try {
    const response = await fetch('/api/hermes/verificar-cliente', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ clienteId }),
    })
    if (!response.ok) return { estado: 'no-disponible' }
    const data = await response.json()
    if (typeof data?.existe !== 'boolean') return { estado: 'no-disponible' }
    return { estado: data.existe ? 'existe' : 'no-existe' }
  } catch {
    return { estado: 'no-disponible' }
  }
}

/**
 * Saldos de varios clientes en una sola llamada.
 * Los ids que NO vengan en el resultado son clientes sin cuenta corriente en
 * Hermes — no son saldo cero. Devuelve un Map para que el consumidor pueda
 * distinguir `undefined` (sin cuenta) de `0` (al día).
 * Si el puente falla devuelve null: tampoco es "todos en cero".
 */
export async function consultarSaldos(clienteIds: number[]): Promise<Map<number, SaldoClienteLote> | null> {
  try {
    const response = await fetch('/api/hermes/consultar-saldos', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ clienteIds }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const rows = Array.isArray(data?.saldos) ? data.saldos : []
    const map = new Map<number, SaldoClienteLote>()
    for (const row of rows) {
      // pos_cliente_id es bigint y hoy viene como número — envolver en Number() igual,
      // defensivamente, como ya se hace con los montos (si PostgREST empezara a
      // serializarlo como string, Number.isFinite de un string siempre da false).
      const posClienteId = Number(row.pos_cliente_id ?? row.posClienteId)
      if (!Number.isFinite(posClienteId)) continue
      map.set(posClienteId, {
        posClienteId,
        // PostgREST serializa numeric como string ("922.40"). Sin Number() el
        // === 0 de la UI nunca se cumple y un cliente al día se ve como deudor
        // de Bs 0,00.
        saldoConfirmado: Number(row.saldo_confirmado ?? row.saldoConfirmado ?? 0),
        saldoProvisional: Number(row.saldo_provisional ?? row.saldoProvisional ?? 0),
        limiteCredito: row.limite_credito != null ? Number(row.limite_credito) : null,
        situacion: row.situacion ?? 'AL_DIA',
      })
    }
    return map
  } catch {
    return null
  }
}

export interface SaldoSimilar {
  posClienteId: number
  hermesClienteId: number | null
  saldoConfirmado: number
  montoEnRevision: number
  saldoProvisional: number
  situacion: string | null
  partidasAbiertas: number
}

/**
 * Brief T2 Tarea 2: saldo de los candidatos del panel de "cliente parecido", en una sola
 * llamada con todos los ids (no una por candidato). Mismo criterio "nunca lanza" que
 * consultarSaldos — acá la caída de Hermes NO puede bloquear el alta del cliente (a
 * diferencia del borrado), así que null significa "no disponible", nunca un error que
 * frene el formulario.
 */
export async function consultarSaldosSimilares(posIds: number[]): Promise<Map<number, SaldoSimilar> | null> {
  try {
    const response = await fetch('/api/hermes/consultar-saldos-similares', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ posIds }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const rows = Array.isArray(data?.saldos) ? data.saldos : []
    const map = new Map<number, SaldoSimilar>()
    for (const row of rows) {
      const posClienteId = Number(row.pos_cliente_id ?? row.posClienteId)
      if (!Number.isFinite(posClienteId)) continue
      map.set(posClienteId, {
        posClienteId,
        hermesClienteId: row.hermes_cliente_id != null ? Number(row.hermes_cliente_id) : null,
        saldoConfirmado: Number(row.saldo_confirmado ?? row.saldoConfirmado ?? 0),
        montoEnRevision: Number(row.monto_en_revision ?? row.montoEnRevision ?? 0),
        saldoProvisional: Number(row.saldo_provisional ?? row.saldoProvisional ?? 0),
        situacion: row.situacion ?? null,
        partidasAbiertas: Number(row.partidas_abiertas ?? row.partidasAbiertas ?? 0),
      })
    }
    return map
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
  if (!response.ok) throw new HermesHttpError((data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) || 'No se pudo registrar el cargo en Hermes', response.status)
  return data as CargoRegistrado
}

/** Mismo contrato que registrarCargoSaldo — SÍ lanza en caso de fallo, el llamador
 * (PagoModal) necesita saberlo para encolar el reintento en pendiente_sync_hermes_pago.
 * El PROPUESTO/confirmación en Hermes es cosa de supervisores en otra app: acá no hay
 * nada que interpretar sobre ese estado, solo éxito (se pudo proponer) o fallo (se encola). */
export async function registrarPago(input: { clienteId: number; monto: number; medio: string; pedidoId?: string | number; movimientoCajaId: string | number; usuarioPos: string; noImputar?: boolean }): Promise<PagoRegistrado> {
  const response = await fetch('/api/hermes/registrar-pago', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new HermesHttpError((data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) || 'No se pudo registrar el pago en Hermes', response.status)
  return data as PagoRegistrado
}

// Brief T4 Tarea 2: una fila por partida abierta del cliente, propuesta por FIFO —
// o_referencia ya viene como PED-2026-XXXXX (Tarea 3: nunca mostrar el id interno).
export interface FilaReparto {
  partidaId: number
  referencia: string
  total: number
  pendiente: number
  aplica: number
  restante: number
}

/** SÍ lanza — el llamador (RepartoPagoPanel) necesita distinguir "no se pudo calcular"
 * de "no hay partidas abiertas" (array vacío, no es un error). */
export async function calcularRepartoFifo(clienteId: number, monto: number): Promise<FilaReparto[]> {
  const response = await fetch('/api/hermes/calcular-reparto', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ clienteId, monto }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new HermesHttpError((data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) || 'No se pudo calcular el reparto', response.status)
  const filas = Array.isArray(data?.filas) ? data.filas : []
  return filas.map((f: Record<string, unknown>) => ({
    partidaId: Number(f.partidaId),
    referencia: String(f.referencia ?? ''),
    total: Number(f.total ?? 0),
    pendiente: Number(f.pendiente ?? 0),
    aplica: Number(f.aplica ?? 0),
    restante: Number(f.restante ?? 0),
  }))
}

// Brief S-I: a diferencia de los demás endpoints, agregar-lineas-pedido puede fallar
// DESPUÉS de que las líneas ya quedaron agregadas en Cation (el paso a Hermes es el que
// falló, y ese paso no se revierte) — cationOk distingue ese caso (el llamador tiene que
// refrescar el pedido igual, aunque el resultado sea un error) de un fallo previo a
// Cation (nada cambió, no hay nada que refrescar).
export class AgregarLineasHttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly cationOk: boolean) {
    super(message)
    this.name = 'AgregarLineasHttpError'
  }
}

export interface AgregarLineasResultado {
  pedidoId: number
  lineasAgregadas: number
  montoAdicional: number
  // null: no hubo monto adicional que sincronizar (ver api/hermes/agregar-lineas-pedido.ts).
  camino: 'MISMA_PARTIDA' | 'PARTIDA_HIJA' | null
  entregaNumero: number | null
}

/** SÍ lanza — el llamador (OrdersPage) necesita distinguir éxito de fallo para decidir
 * qué mensaje mostrar. El mensaje de error, cuando viene de Hermes (p. ej. "el pedido no
 * tiene ninguna partida abierta"), se propaga tal cual — nunca se reemplaza por uno
 * genérico. */
export async function agregarLineasPedido(input: { pedidoId: number | string; lineas: unknown[]; motivo?: string }): Promise<AgregarLineasResultado> {
  const response = await fetch('/api/hermes/agregar-lineas-pedido', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ pedidoId: input.pedidoId, lineas: input.lineas, motivo: input.motivo || undefined }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) || 'No se pudieron agregar los ítems al pedido'
    const cationOk = data != null && typeof data === 'object' && 'lineasAgregadas' in data
    throw new AgregarLineasHttpError(message, response.status, cationOk)
  }
  return {
    pedidoId: Number(data?.pedidoId),
    lineasAgregadas: Number(data?.lineasAgregadas ?? 0),
    montoAdicional: Number(data?.montoAdicional ?? 0),
    camino: data?.camino === 'MISMA_PARTIDA' || data?.camino === 'PARTIDA_HIJA' ? data.camino : null,
    entregaNumero: data?.entregaNumero != null ? Number(data.entregaNumero) : null,
  }
}

export interface ImputacionGuardada {
  pagoId: number
  aplicaciones: number
  imputado: number
  excedente: number
}

/** SÍ lanza, con el mensaje literal de imputar_pago (montos inválidos, partida ajena,
 * pago ya confirmado, etc.) — nunca reemplazarlo por un genérico, la RPC ya lo redacta
 * para mostrarse tal cual. */
export async function imputarPago(pagoId: string | number, aplicaciones: Array<{ partidaId: number; monto: number }>, usuarioPos: string): Promise<ImputacionGuardada> {
  const response = await fetch('/api/hermes/imputar-pago', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ pagoId, aplicaciones, usuarioPos }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new HermesHttpError((data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) || 'No se pudo guardar el reparto', response.status)
  return {
    pagoId: Number(data?.pagoId),
    aplicaciones: Number(data?.aplicaciones ?? 0),
    imputado: Number(data?.imputado ?? 0),
    excedente: Number(data?.excedente ?? 0),
  }
}
