import { useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, QrCode, Landmark, ArrowLeftRight, Building2, ReceiptText } from 'lucide-react'
import { Modal } from './Modal'
import { NumberField } from './NumberField'
import { authSessionProvider, customerService, cashService, sensitiveOperations, turnoService } from '../infrastructure/services'
import { useCashSession } from '../context/CashSessionContext'
import { featureFlags } from '../config/featureFlags'
import { consultarCuentaCobro, type CuentaCobro } from '../infrastructure/hermes/client'
import { type PosPaymentMethodExt } from '../infrastructure/supabase/mappers'
import { formatMoney, money, moneyFromDecimal } from '../domain/common/money'
import type { CustomerRecord } from '../application/shared/models'
import { RepartoPagoPanel } from './RepartoPagoPanel'
import type { FilaRepartoEditable } from '../domain/hermes/repartoPago'
import { asignarMonto, combinacionExacta, mensajeSobrante, validarCobroPedidos, type FilaAsignable } from '../domain/hermes/asignacionPedidos'
import { createUuid } from '../application/shared/createUuid'
import { CobroDestinoField } from './CobroDestinoField'
import { aplicarDestinoCobro, destinoObligatorio, destinoPendiente, useCobroDestino } from './useCobroDestino'
import { paymentAttemptKey, paymentRejected, readPaymentAttempt, type PaymentAttempt } from '../domain/hermes/paymentAttempt'
import { aplicarSaldoPedido, avisarSaldoActualizado } from '../infrastructure/supabase/SaldoCliente.supabase'

const metodoLabels: Record<PosPaymentMethodExt, string> = { cash: 'Efectivo', qr: 'QR', deposit: 'Depósito', transfer: 'Transferencia', sigep: 'SIGEP', check: 'Cheque' }
const metodoOrder: PosPaymentMethodExt[] = ['cash', 'qr', 'deposit', 'transfer', 'sigep', 'check']
const metodoIcons: Record<PosPaymentMethodExt, typeof Banknote> = { cash: Banknote, qr: QrCode, deposit: Landmark, transfer: ArrowLeftRight, sigep: Building2, check: ReceiptText }
const tipoLabels: Record<string, string> = { retail: 'Minorista', wholesale: 'Mayorista', institutional: 'Institucional', corporate: 'Corporativo' }

export type PagoTab = 'pedidos' | 'antiguedad' | 'anticipo'
const tabLabels: Record<PagoTab, string> = { pedidos: 'Pedidos', antiguedad: 'Por antigüedad', anticipo: 'Anticipo' }
export const MOTIVOS_ANTICIPO = [
  { code: 'ADELANTO_PEDIDO_FUTURO', label: 'Paga por adelantado un pedido que aún no se crea' },
  { code: 'NO_ES_PARA_PENDIENTES', label: 'El cliente indicó que no es para los pedidos pendientes' },
  { code: 'GARANTIA_RESERVA', label: 'Garantía o reserva acordada con gerencia' },
  { code: 'OTRO', label: 'Otro (explicar)' },
] as const
const DETALLE_MIN = 10
const DETALLE_MAX = 500

const bs = (value: number) => formatMoney(moneyFromDecimal(value))
const fechaCorta = (iso?: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ''); return m ? `${m[3]}/${m[2]}` : '' }
const unir = (items: string[]) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
const hintOf = (err: unknown) => (err && typeof err === 'object' && 'hint' in err ? String((err as { hint?: unknown }).hint ?? '') : '')

// Caja y propuesta de Hermes se registran juntas. La confirmación autorizada es posterior.
export function PagoModal({ onClose, notify = () => undefined, initialCustomer, initialTab }: { onClose: () => void; notify?: (message: string) => void; initialCustomer?: CustomerRecord; initialTab?: PagoTab }) {
  const { sessionId } = useCashSession()
  // Brief S5: estable por apertura del modal (no por render), análogo a operationId en
  // PosContext — así un doble click con la red cortada y restablecida reusa la misma
  // clave de idempotencia en vez de crear dos movimiento_caja.
  const pagoOperationId = useRef(createUuid())
  const saldoOperationId = useRef(createUuid())
  const sending = useRef(false)
  const [actorId, setActorId] = useState<string | null>(null)
  const [identityLoading, setIdentityLoading] = useState(true)
  const [pending, setPending] = useState<PaymentAttempt | null>(null)
  const [referencia, setReferencia] = useState('')
  const [customer, setCustomer] = useState<CustomerRecord | null>(initialCustomer ?? null)
  const integraConciliador = !!customer && customer.type !== 'retail' && featureFlags.supabase
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerRecord[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [tab, setTab] = useState<PagoTab>(initialTab ?? 'pedidos')
  const [turnoNombre, setTurnoNombre] = useState('')
  const [cuenta, setCuenta] = useState<CuentaCobro | null>(null)
  const [cuentaLoading, setCuentaLoading] = useState(false)
  const [cuentaError, setCuentaError] = useState('')
  const [cuentaRetry, setCuentaRetry] = useState(0)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<PosPaymentMethodExt | null>(null)
  const { esEncargado, destino, setDestino } = useCobroDestino()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ amountCents: number; customerName: string; inHermes: boolean } | null>(null)
  const [repartoFilas, setRepartoFilas] = useState<FilaRepartoEditable[]>([])
  const [repartoError, setRepartoError] = useState<string | null>(null)
  const [repartoContext, setRepartoContext] = useState('')
  const [repartoRetry, setRepartoRetry] = useState(0)
  const [motivo, setMotivo] = useState('')
  const [detalle, setDetalle] = useState('')
  const [saldoPaso, setSaldoPaso] = useState<'cerrado' | 'confirmar' | 'aplicando'>('cerrado')
  const [saldoMensaje, setSaldoMensaje] = useState('')

  useEffect(() => {
    let active = true
    void authSessionProvider.getSession().then(session => {
      if (!active) return
      const id = session?.user.id ?? (featureFlags.supabase ? null : 'mock')
      setActorId(id)
      if (id) setPending(readPaymentAttempt(id))
    }).catch(() => { if (active) setError('No se pudo comprobar tu sesión. Vuelve a abrir el formulario.') })
      .finally(() => { if (active) setIdentityLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!featureFlags.supabase || !sessionId) return
    let active = true
    void Promise.resolve().then(() => turnoService.getSesionAbierta?.()).then(sesion => { if (active && sesion?.cajaNombre) setTurnoNombre(sesion.cajaNombre) }).catch(() => undefined)
    return () => { active = false }
  }, [sessionId])

  // Cuenta de cobro: pedidos abiertos + saldo a favor sin aplicar (solo clientes no retail).
  useEffect(() => {
    if (!integraConciliador || !customer) {
      void Promise.resolve().then(() => { setCuenta(null); setCuentaLoading(false); setCuentaError('') })
      return
    }
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) { setCuenta(null); setCuentaLoading(true); setCuentaError('') } })
    void consultarCuentaCobro(customer.id)
      .then(result => { if (!cancelled) setCuenta(result) })
      .catch(() => { if (!cancelled) setCuentaError('No se pudieron consultar los pedidos del cliente.') })
      .finally(() => { if (!cancelled) setCuentaLoading(false) })
    return () => { cancelled = true }
  }, [integraConciliador, customer, cuentaRetry])

  useEffect(() => {
    if (!showCustomerPicker) return
    let cancelled = false
    const handle = setTimeout(() => {
      setSearching(true); setSearchError('')
      void customerService.list({ query: customerQuery, page: { page: 1, pageSize: 8 } })
        .then((list) => { if (!cancelled) setCustomerResults(list) })
        .catch(() => { if (!cancelled) { setCustomerResults([]); setSearchError('No se pudo buscar. Reintenta la búsqueda.') } })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [showCustomerPicker, customerQuery])

  const pickCustomer = (record: CustomerRecord) => {
    setCustomer(record); setShowCustomerPicker(false); setCustomerQuery('')
    setMarcadas(new Set()); setRepartoFilas([]); setRepartoContext(''); setRepartoError(null)
    setMotivo(''); setDetalle(''); setAmount(0); setError(''); setSaldoPaso('cerrado'); setSaldoMensaje('')
  }

  const filas = useMemo<FilaAsignable[]>(() => cuenta ? [
    ...cuenta.pedidos.map(p => ({ clave: `p-${p.pedidoId}`, etiqueta: p.numero, fecha: p.fecha, pendiente: p.pendiente, partidas: p.partidas })),
    ...cuenta.partidasSinPedido.map(p => ({ clave: `s-${p.partidaId}`, etiqueta: p.referencia, fecha: p.fecha, pendiente: p.pendiente, partidas: [{ partidaId: p.partidaId, pendiente: p.pendiente }] })),
  ] : [], [cuenta])
  const sinPedido = useMemo(() => new Set(cuenta?.partidasSinPedido.map(p => `s-${p.partidaId}`) ?? []), [cuenta])
  // Marcas vigentes: ignora claves que ya no existen tras recargar la cuenta.
  const marcadasVigentes = useMemo(() => new Set(filas.filter(f => marcadas.has(f.clave)).map(f => f.clave)), [filas, marcadas])
  const asignacion = useMemo(() => asignarMonto(amount, filas, marcadasVigentes), [amount, filas, marcadasVigentes])
  const sugerencia = useMemo(() => marcadasVigentes.size === 0 && amount > 0 ? combinacionExacta(amount, filas) : null, [amount, filas, marcadasVigentes])
  const aplicaPorClave = new Map(asignacion.filas.map(f => [f.clave, f.seAplica]))

  const abiertos = cuenta ? cuenta.pedidos.length + cuenta.partidasSinPedido.length : 0
  const pendienteTotal = cuenta?.pendienteTotal ?? 0
  const tienePendientes = integraConciliador && pendienteTotal > 0
  const modoSimple = !integraConciliador
  const efectivaTab: PagoTab = modoSimple ? 'pedidos' : tab
  const cuentaLista = !!cuenta && !cuentaLoading && !cuentaError

  // Reparto por antigüedad (FIFO editable): si sobra dinero mientras quedan partidas abiertas, se bloquea.
  const repartoAplicado = repartoFilas.reduce((sum, f) => sum + f.aplica, 0)
  const repartoSobrante = Math.max(0, Math.round((amount - repartoAplicado) * 100) / 100)
  const repartoQuedanAbiertas = repartoFilas.some(f => Math.round((f.pendiente - f.aplica) * 100) > 0)
  const repartoBloqueo = efectivaTab === 'antiguedad' && repartoSobrante > 0 && repartoQuedanAbiertas ? mensajeSobrante(repartoSobrante) : null

  const detalleTrim = detalle.trim()
  const requiereMotivo = efectivaTab === 'anticipo' && tienePendientes
  const motivoError = !requiereMotivo ? null
    : !motivo ? 'Elige el motivo del anticipo.'
      : motivo === 'OTRO' && detalleTrim.length < DETALLE_MIN ? `Explica el motivo (mínimo ${DETALLE_MIN} caracteres).`
        : null

  const bloqueo: string | null = (() => {
    if (!customer) return 'Elige un cliente.'
    if (!(Math.round(amount * 100) > 0)) return 'Escribe el monto recibido.'
    if (modoSimple) return null
    if (cuentaLoading) return 'Consultando los pedidos del cliente…'
    if (!cuentaLista) return 'No se pudieron consultar los pedidos. Reintenta la consulta.'
    if (efectivaTab === 'pedidos') return validarCobroPedidos({ monto: amount, filas, marcadas: marcadasVigentes })
    if (efectivaTab === 'antiguedad') {
      if (repartoContext !== `${customer.id}:${amount}` || repartoError) return repartoError ?? 'Calculando el reparto…'
      return repartoBloqueo
    }
    return motivoError
  })()

  const valid = !!customer && !!method && !!actorId && !identityLoading && !!sessionId && !bloqueo && !destinoPendiente(esEncargado, method, destino)

  const resumen = (() => {
    if (!customer) return 'Elige el cliente que paga.'
    if (bloqueo && amount > 0 && (efectivaTab === 'pedidos' ? marcadasVigentes.size > 0 : true)) return bloqueo
    if (modoSimple) return amount > 0 ? `Registra ${bs(amount)} en caja a nombre de ${customer.name}.` : ''
    if (efectivaTab === 'pedidos') {
      const etiquetas = filas.filter(f => marcadasVigentes.has(f.clave)).map(f => f.etiqueta)
      const base = etiquetas.length ? `Paga ${unir(etiquetas)}.` : 'Marca los pedidos que paga este dinero.'
      return asignacion.sobrante > 0 ? `${base} Quedan ${bs(asignacion.sobrante)} a favor de ${customer.name}.` : base
    }
    if (efectivaTab === 'antiguedad') {
      const etiquetas = repartoFilas.filter(f => f.aplica > 0).map(f => f.referencia)
      return etiquetas.length ? `Paga ${unir(etiquetas)} por antigüedad.` : ''
    }
    const primero = cuenta?.pedidos[0]?.numero
    const sigue = abiertos === 0 ? '' : abiertos === 1 && primero ? ` ${primero} sigue pendiente.` : ` ${abiertos} pedidos siguen pendientes.`
    return amount > 0 ? `Queda ${bs(amount)} a favor de ${customer.name}.${sigue}` : ''
  })()

  const confirm = async () => {
    if (sending.current || !actorId || (!pending && !valid)) return
    sending.current = true
    setSubmitting(true)
    setError('')
    try {
      let aplicaciones: { partidaId: number; monto: number }[] | undefined
      let noImputar = false
      let anticipoMotivo: string | null = null
      let anticipoDetalle: string | null = null
      if (!modoSimple && efectivaTab === 'pedidos') aplicaciones = asignacion.aplicaciones
      else if (!modoSimple && efectivaTab === 'antiguedad') {
        const lista = repartoFilas.filter(f => f.aplica > 0).map(f => ({ partidaId: f.partidaId, monto: f.aplica }))
        aplicaciones = lista.length ? lista : undefined
        noImputar = lista.length === 0
      } else if (!modoSimple) {
        noImputar = true
        if (requiereMotivo) { anticipoMotivo = motivo; anticipoDetalle = detalleTrim || null }
      }
      const attempt: PaymentAttempt = pending ?? { operationId: pagoOperationId.current, customer: customer!, amountCents: moneyFromDecimal(amount).cents, method: method!, sessionId: sessionId!, noImputar, aplicaciones: aplicaciones?.length ? aplicaciones : undefined, destino: destinoObligatorio(esEncargado, method) ? destino : null, referencia: referencia.trim(), anticipoMotivo, anticipoDetalle }
      localStorage.setItem(paymentAttemptKey(actorId), JSON.stringify(attempt)); setPending(attempt)
      const { operationId: id, customer: client, destino: target, anticipoMotivo: motivoEnviado, anticipoDetalle: detalleEnviado, ...payment } = attempt
      const amountCents = attempt.amountCents
      // Brief S5: la huella cubre todo el intento (cliente, importe, medio, caja, reparto y motivo
      // del anticipo): un reintento idéntico reusa la clave (un solo movimiento_caja); cambiar
      // cualquier dato tras un cobro fallido da una huella distinta, o sea un pago nuevo.
      const huella = JSON.stringify({ ...payment, anticipoMotivo: motivoEnviado ?? null, anticipoDetalle: detalleEnviado ?? null })
      const resultado = await sensitiveOperations.ejecutarIdempotente(
        'register_payment',
        id,
        huella,
        (idempotencyKey) => cashService.registerPayment({
          ...payment,
          customerId: client.id,
          anticipoMotivo: motivoEnviado ?? undefined,
          anticipoDetalle: detalleEnviado ?? undefined,
          idempotencyKey,
        }),
      )
      localStorage.removeItem(paymentAttemptKey(actorId)); setPending(null)
      await aplicarDestinoCobro(target, resultado?.movementId, notify)
      avisarSaldoActualizado(); window.dispatchEvent(new Event('pago-cliente-registrado'))
      setDone({ amountCents, customerName: client.name, inHermes: !!resultado && 'pagoId' in resultado && !!resultado.pagoId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el pago')
      if (paymentRejected(err)) {
        localStorage.removeItem(paymentAttemptKey(actorId)); setPending(null)
        if (hintOf(err) === 'anticipo_requiere_motivo') setTab('anticipo')
      }
    } finally {
      setSubmitting(false)
      sending.current = false
    }
  }

  // Aplicar el saldo a favor sin aplicar a los pedidos abiertos, del más antiguo al más nuevo.
  const planSaldo = useMemo(() => {
    let restante = Math.round((cuenta?.aFavorLibre ?? 0) * 100)
    const plan: { pedidoId: number; numero: string; monto: number }[] = []
    for (const p of cuenta?.pedidos ?? []) {
      if (restante <= 0) break
      const monto = Math.min(restante, Math.round(p.pendiente * 100))
      if (monto > 0) { plan.push({ pedidoId: p.pedidoId, numero: p.numero, monto: monto / 100 }); restante -= monto }
    }
    return plan
  }, [cuenta])
  const aplicarSaldo = async () => {
    if (!sessionId || !customer) return
    setSaldoPaso('aplicando'); setSaldoMensaje('')
    const aplicados: string[] = []
    try {
      for (const item of planSaldo) {
        await aplicarSaldoPedido({ pedidoId: String(item.pedidoId), saldoBs: item.monto, sesionId: sessionId, key: `saldo-${item.pedidoId}-${saldoOperationId.current}`, dineroNuevoBs: 0 })
        aplicados.push(item.numero)
      }
      saldoOperationId.current = createUuid()
      setSaldoPaso('cerrado'); setSaldoMensaje(aplicados.length ? `Saldo aplicado a ${unir(aplicados)}.` : '')
      setMarcadas(new Set()); setCuentaRetry(n => n + 1)
    } catch (err) {
      setSaldoPaso('confirmar')
      setSaldoMensaje(`${err instanceof Error ? err.message : 'No se pudo aplicar el saldo'}${aplicados.length ? ` Ya se aplicó a ${unir(aplicados)}.` : ''}`)
      if (aplicados.length) setCuentaRetry(n => n + 1)
    }
  }

  if (done) return <Modal title="Pago registrado" onClose={onClose}><div className="modal-body success-state">
    <span>✓</span>
    <h3>{formatMoney(money(done.amountCents))}</h3>
    <p>{featureFlags.supabase && done.inHermes ? `Registrado en caja y en Hermes para ${done.customerName}. Pendiente de revisión.` : `Pago registrado en caja para ${done.customerName}.`}</p>
  </div><footer className="modal-actions"><button className="primary-button full-button" onClick={onClose}>Cerrar</button></footer></Modal>

  const close = () => { if (!sending.current) onClose() }
  const cajaCerrada = featureFlags.supabase && !sessionId
  const subtitle = cajaCerrada
    ? <span className="pago-msg-error-text">Caja cerrada — abre la caja para registrar un pago.</span>
    : `Caja abierta${turnoNombre ? ` · ${turnoNombre}` : ''}`
  const marcarUnico = (clave: string) => { setMarcadas(new Set([clave])); setTab('pedidos') }
  const unicoPedido = abiertos === 1 ? cuenta?.pedidos[0] : undefined
  const botonLabel = submitting ? 'Registrando…' : pending ? 'Comprobar el mismo pago' : efectivaTab === 'anticipo' && !modoSimple ? `Registrar anticipo ${bs(amount)}` : `Registrar ${bs(amount)}`
  const resumenEsError = !!error || (!!bloqueo && amount > 0 && /^Sobran|^Explica|^Elige el motivo|No se pudo/.test(bloqueo))

  return <Modal title="Registrar pago" subtitle={subtitle} className="payment-account-modal" onClose={close} escapeToClose={!submitting} wide>
    {pending && <div role="status" className="payment-account-pending"><strong>Pago pendiente de comprobar</strong><p>{pending.customer.name} · {formatMoney(money(pending.amountCents))} · {metodoLabels[pending.method]}</p><small>Reutiliza este intento para evitar cobrar dos veces.</small></div>}
    <div className="modal-body pago-scroll">
    <fieldset disabled={submitting || !!pending || identityLoading} className="pago-body">
      <section className="pago-section">
        <label className="pago-label" htmlFor="pago-cliente">Cliente</label>
        <div className="customer-search">
          <input
            id="pago-cliente"
            aria-label="Buscar cliente para registrar pago"
            autoComplete="off"
            value={showCustomerPicker ? customerQuery : (customer?.name ?? '')}
            placeholder="Buscar cliente por nombre, documento o correo..."
            onFocus={() => setShowCustomerPicker(true)}
            onChange={(e) => { setCustomerQuery(e.target.value); setShowCustomerPicker(true) }}
          />
          {showCustomerPicker && (
            <div className="customer-search-results">
              {!searching && customerResults.map((c) => <button type="button" key={c.id} onClick={() => pickCustomer(c)}><strong>{c.name}</strong><small>{c.document || 'Sin documento'} · {c.usualChannel}</small></button>)}
              {searching ? <span role="status" className="empty-hint">Buscando clientes…</span> : searchError ? <span role="alert" className="empty-hint">{searchError}</span> : !customerResults.length && <span className="empty-hint">Sin resultados.</span>}
              <button type="button" className="close-picker" onClick={() => setShowCustomerPicker(false)}>Cerrar</button>
            </div>
          )}
        </div>
        {customer && <p className="pago-cliente-meta"><span className="pago-chip">{tipoLabels[customer.type] ?? customer.type}</span> {customer.name}</p>}
        {integraConciliador && cuentaLoading && <p role="status" className="pago-msg pago-msg-info">Consultando pedidos del cliente…</p>}
        {integraConciliador && cuentaError && <div role="alert" className="pago-msg pago-msg-error">{cuentaError} <button type="button" className="pago-link" onClick={() => setCuentaRetry(n => n + 1)}>Reintentar</button></div>}
        {integraConciliador && cuentaLista && cuenta && <>
          <div className="pago-tiles">
            <div className="pago-tile"><span>Pendiente en pedidos</span><strong>{bs(cuenta.pendienteTotal)}</strong><small>{cuenta.pedidos.length} {cuenta.pedidos.length === 1 ? 'pedido abierto' : 'pedidos abiertos'}</small></div>
            <div className={`pago-tile ${cuenta.aFavorLibre > 0 ? 'pago-tile-favor' : ''}`}><span>A favor sin aplicar</span><strong>{bs(cuenta.aFavorLibre)}</strong></div>
          </div>
          {cuenta.aFavorLibre > 0 && cuenta.pendienteTotal > 0 && saldoPaso === 'cerrado' && <div className="pago-msg pago-msg-warning">
            <span>Este cliente tiene saldo a favor y pedidos pendientes al mismo tiempo. Aplica ese saldo antes de registrar dinero nuevo.</span>
            <button type="button" className="secondary-button" disabled={!sessionId} onClick={() => { setSaldoMensaje(''); setSaldoPaso('confirmar') }}>Aplicar saldo</button>
          </div>}
          {saldoPaso !== 'cerrado' && <div className="pago-msg pago-msg-info" role="group" aria-label="Confirmar aplicación del saldo">
            <strong>Se aplicará el saldo a favor así:</strong>
            <ul>{planSaldo.map(p => <li key={p.pedidoId}>{p.numero}: {bs(p.monto)}</li>)}</ul>
            <div className="pago-msg-actions">
              <button type="button" className="secondary-button" disabled={saldoPaso === 'aplicando'} onClick={() => setSaldoPaso('cerrado')}>Cancelar</button>
              <button type="button" className="primary-button" disabled={saldoPaso === 'aplicando' || !planSaldo.length} onClick={() => void aplicarSaldo()}>{saldoPaso === 'aplicando' ? 'Aplicando…' : 'Confirmar y aplicar saldo'}</button>
            </div>
          </div>}
          {saldoMensaje && <p role="status" className={`pago-msg ${/^Saldo aplicado/.test(saldoMensaje) ? 'pago-msg-info' : 'pago-msg-error'}`}>{saldoMensaje}</p>}
        </>}
        {customer?.type === 'retail' && <p className="pago-msg pago-msg-info">Este pago se registra en Seller. Los clientes retail quedan fuera del conciliador.</p>}
      </section>

      <section className="pago-section">
        <h3 className="pago-heading">¿Qué paga?</h3>
        {!modoSimple && <div className="pago-tabs" role="tablist" aria-label="¿Qué paga?">
          {(Object.keys(tabLabels) as PagoTab[]).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{tabLabels[t]}</button>)}
        </div>}
        <label className="pago-monto">
          <span className="pago-label">Monto recibido (Bs)</span>
          <NumberField ariaLabel="Monto recibido (Bs)" className="pago-monto-input" min={0} step={0.01} value={amount} onCommit={(v) => { setAmount(v); setError('') }} />
        </label>

        {!modoSimple && efectivaTab === 'pedidos' && cuentaLista && <>
          {sugerencia && <div className="pago-msg pago-msg-info pago-sugerencia">
            <span>Coincide exacto con <strong>{sugerencia.map(f => f.etiqueta).join(' + ')}</strong></span>
            <button type="button" className="secondary-button" onClick={() => setMarcadas(new Set(sugerencia.map(f => f.clave)))}>Marcar estos</button>
          </div>}
          {filas.length === 0
            ? <p className="pago-msg pago-msg-info">Este cliente no tiene pedidos pendientes de pago.</p>
            : <div className="pago-tabla-scroll"><div className="pago-tabla" role="group" aria-label="Pedidos pendientes">
              <div className="pago-tabla-head" aria-hidden="true"><span /><span>Pedido</span><span>Fecha</span><span className="num">Pendiente</span><span className="num">Se paga</span></div>
              {filas.map(f => {
                const marcada = marcadasVigentes.has(f.clave)
                const aplica = aplicaPorClave.get(f.clave) ?? 0
                const estado = marcada && aplica > 0 ? (Math.round((f.pendiente - aplica) * 100) <= 0 ? 'Queda pagado' : 'Pago parcial') : sinPedido.has(f.clave) ? 'Saldo anterior' : 'Pendiente'
                return <label key={f.clave} className={`pago-fila ${marcada ? 'marcada' : ''}`}>
                  <input type="checkbox" checked={marcada} onChange={() => setMarcadas(prev => { const next = new Set(prev); if (next.has(f.clave)) next.delete(f.clave); else next.add(f.clave); return next })} aria-label={`Marcar ${f.etiqueta}`} />
                  <span className="pago-fila-pedido"><strong>{f.etiqueta}</strong><small className={estado === 'Queda pagado' ? 'ok' : ''}>{estado}</small></span>
                  <span className="pago-fila-fecha">{fechaCorta(f.fecha)}</span>
                  <span className="num">{bs(f.pendiente)}</span>
                  <span className="num">{marcada ? bs(aplica) : '—'}</span>
                </label>
              })}
              <div className="pago-tabla-pie">
                <span>{marcadasVigentes.size} {marcadasVigentes.size === 1 ? 'pedido marcado' : 'pedidos marcados'}</span>
                <span className={asignacion.sobrante > 0 ? 'pago-msg-error-text' : ''}>{asignacion.sobrante > 0 ? `Sobran ${bs(asignacion.sobrante)}` : `Monto cubierto ${bs(asignacion.aplicado)}`}</span>
              </div>
            </div></div>}
        </>}

        {!modoSimple && efectivaTab === 'antiguedad' && customer && cuentaLista && amount > 0 && <>
          <RepartoPagoPanel key={`${customer.id}:${repartoRetry}`} clienteId={Number(customer.id)} monto={amount} onFilasChange={(f, err, context) => { setRepartoFilas(f); setRepartoError(err); setRepartoContext(context ?? '') }} />
          {repartoError && !repartoError.startsWith('Consultando') && <button type="button" className="secondary-button" onClick={() => { setRepartoContext(''); setRepartoRetry(n => n + 1) }}>Reintentar reparto</button>}
          {repartoBloqueo && <p role="alert" className="pago-msg pago-msg-error">{repartoBloqueo}</p>}
        </>}

        {!modoSimple && efectivaTab === 'anticipo' && cuentaLista && <>
          {tienePendientes && <div role="alert" className="pago-msg pago-msg-warning">
            <span>Este cliente tiene {abiertos} {abiertos === 1 ? 'pedido pendiente' : 'pedidos pendientes'} por {bs(pendienteTotal)}. Un anticipo no los paga: seguirán figurando como pendientes en el Seller, en Hermes y en el Dashboard. Si el dinero es por esos pedidos, regístralo en la pestaña Pedidos.</span>
            <button type="button" className="secondary-button" onClick={() => unicoPedido ? marcarUnico(`p-${unicoPedido.pedidoId}`) : setTab('pedidos')}>{unicoPedido ? `Pagar ${unicoPedido.numero} en su lugar` : 'Ir a Pedidos'}</button>
          </div>}
          {tienePendientes && <>
            <label className="pago-campo"><span className="pago-label">Motivo del anticipo (obligatorio)</span>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                <option value="" disabled>Elige un motivo…</option>
                {MOTIVOS_ANTICIPO.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select></label>
            <label className="pago-campo"><span className="pago-label">Detalle{motivo === 'OTRO' ? ' (obligatorio)' : ' (opcional)'}</span>
              <textarea rows={3} maxLength={DETALLE_MAX} value={detalle} onChange={(e) => setDetalle(e.target.value)} /></label>
            <p className="pago-nota">El motivo queda guardado con el pago y lo ve el gerente al confirmarlo en el Conciliador.</p>
          </>}
        </>}
      </section>

      <section className="pago-section">
        <h3 className="pago-heading" id="pago-medio-titulo">Medio de pago</h3>
        <div className="pago-medios" role="group" aria-labelledby="pago-medio-titulo">
          {metodoOrder.map((m) => { const Icon = metodoIcons[m]; return <button key={m} type="button" aria-pressed={method === m} className={method === m ? 'active' : ''} onClick={() => { setMethod(m); setDestino(null) }}><Icon aria-hidden="true" /><span>{metodoLabels[m]}</span></button> })}
        </div>
        {destinoObligatorio(esEncargado, method) && <CobroDestinoField value={destino} onChange={setDestino} disabled={submitting} />}
        <label className="pago-campo"><span className="pago-label">Referencia (opcional)</span><input maxLength={200} value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Número de depósito o comprobante" /></label>
      </section>
    </fieldset>
    </div>
    <footer className="modal-actions pago-footer">
      <p className={`pago-resumen ${resumenEsError ? 'pago-msg-error-text' : ''}`} role={error ? 'alert' : 'status'}>{error || resumen}</p>
      <div className="pago-footer-botones">
        <button className="secondary-button" disabled={submitting} onClick={close}>{pending ? 'Cerrar y conservar intento' : 'Cancelar'}</button>
        <button className="primary-button" disabled={identityLoading || (!pending && !valid) || submitting} onClick={() => void confirm()}>{botonLabel}</button>
      </div>
    </footer>
  </Modal>
}
