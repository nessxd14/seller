import { supabase } from '../supabase/supabaseClient'

export interface PedidoParaCobro { id: string; number: string; pendienteBs: number }
export async function consultarPedidosCobro(clienteId: string): Promise<PedidoParaCobro[]> {
  const { data, error } = await supabase.rpc('pedidos_cobro_cliente', { p_cliente_id: Number(clienteId) })
  if (error) throw Object.assign(new Error(error.message), error)
  return (data ?? []).map((r: { id: number; numero: string; pendiente: number }) => ({ id: String(r.id), number: r.numero, pendienteBs: Number(r.pendiente) }))
}

// Consulta la misma base del POS con su sesión y permisos, sin puente entre proyectos.
async function consultarHermesLocal(url: string, options: RequestInit): Promise<Response> {
  const body = JSON.parse(String(options.body ?? '{}'))
  const operations: Record<string, string> = {
    'consultar-saldo': 'saldo', 'consultar-saldos': 'saldos',
    'consultar-saldos-similares': 'similares', 'evaluar-credito': 'credito',
    'verificar-cliente': 'existe', 'calcular-reparto': 'reparto',
  }
  const operation = operations[url.split('/').pop() ?? '']
  const { data, error } = await supabase.rpc('consultar_hermes_pos', {
    p_operacion: operation,
    p_cliente_ids: body.clienteIds ?? body.posIds ?? [body.clienteId],
    p_monto: body.monto ?? null,
  })
  if (error) return Response.json({ error: error.message }, { status: 502 })
  if (operation === 'saldo') return Response.json(data ? {
    saldoConfirmado: data.saldo_confirmado, saldoProvisional: data.saldo_provisional, situacion: data.situacion,
  } : { sinCuenta: true })
  if (operation === 'credito') return Response.json(data ? {
    permitido: data.permitido, saldoConfirmado: data.saldo_confirmado,
    limiteCredito: data.limite_credito, motivoAdvertencia: data.motivo_advertencia,
  } : { sinCuenta: true })
  if (operation === 'saldos' || operation === 'similares') return Response.json({ saldos: data })
  if (operation === 'reparto') return Response.json({ filas: data })
  return Response.json(data)
}


// Las consultas habituales usan la sesión del POS. Las mutaciones heredadas conservan
// endpoints de servidor; ninguna clave de servicio se incluye en este cliente.

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
    const response = await consultarHermesLocal('/api/hermes/consultar-saldo', {
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
    const response = await consultarHermesLocal('/api/hermes/evaluar-credito', {
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
    const response = await consultarHermesLocal('/api/hermes/verificar-cliente', {
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
    const response = await consultarHermesLocal('/api/hermes/consultar-saldos', {
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
    const response = await consultarHermesLocal('/api/hermes/consultar-saldos-similares', {
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
  const response = await consultarHermesLocal('/api/hermes/calcular-reparto', {
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

// SEL-01: la ampliación es una sola transacción en la base (public.ampliar_pedido): las
// líneas y el cargo en la cartera se confirman juntos o no se confirma nada. La clave la
// genera quien llama y se reutiliza en cada reintento del mismo envío: si la respuesta se
// pierde, repetir con la misma clave devuelve el resultado ya confirmado sin agregar nada.
export class AmpliarPedidoError extends Error {
  constructor(message: string, public readonly code: string | null) {
    super(message)
    this.name = 'AmpliarPedidoError'
  }
  /** PT409: la clave ya se usó con otro contenido, o el pedido cambió mientras se editaba. */
  get esConflicto(): boolean { return this.code === 'PT409' }
}

export interface AgregarLineasResultado {
  pedidoId: number
  lineasAgregadas: number
  montoAdicional: number
  version: number
  // null: sin cargo en cartera (ítems sin costo o cliente sin cuenta corriente).
  camino: 'MISMA_PARTIDA' | 'PARTIDA_HIJA' | null
  entregaNumero: number | null
  /** true: la base ya había confirmado esta misma ampliación (reintento). */
  repetida: boolean
}

/** SÍ lanza AmpliarPedidoError con el mensaje literal de la base. Si lanza, no quedó nada
 * escrito: la transacción se revierte entera. */
export async function agregarLineasPedido(input: {
  pedidoId: number | string
  clave: string
  lineas: unknown[]
  motivo?: string
  versionEsperada?: number
}): Promise<AgregarLineasResultado> {
  const { data, error } = await supabase.rpc('ampliar_pedido', {
    p_pedido_id: Number(input.pedidoId),
    p_clave: input.clave,
    p_lineas: input.lineas,
    p_motivo: input.motivo || null,
    p_version_esperada: input.versionEsperada ?? null,
  })
  if (error) throw new AmpliarPedidoError(error.message || 'No se pudieron agregar los ítems al pedido', error.code ?? null)
  const r = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return {
    pedidoId: Number(r.pedido_id),
    lineasAgregadas: Number(r.lineas_agregadas ?? 0),
    montoAdicional: Number(r.monto_adicional ?? 0),
    version: Number(r.version ?? 0),
    camino: r.camino === 'MISMA_PARTIDA' || r.camino === 'PARTIDA_HIJA' ? r.camino : null,
    entregaNumero: r.entrega_numero != null ? Number(r.entrega_numero) : null,
    repetida: r.repetida === true,
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
