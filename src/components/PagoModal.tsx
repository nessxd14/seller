import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { NumberField } from './NumberField'
import { authSessionProvider, customerService, orderService, cashService, sensitiveOperations } from '../infrastructure/services'
import { useCashSession } from '../context/CashSessionContext'
import { featureFlags } from '../config/featureFlags'
import { consultarSaldo, consultarPedidosCobro, type PedidoParaCobro, type ResultadoSaldo } from '../infrastructure/hermes/client'
import { type PosPaymentMethodExt } from '../infrastructure/supabase/mappers'
import { formatMoney, money, moneyFromDecimal } from '../domain/common/money'
import type { CustomerRecord } from '../application/shared/models'
import { RepartoPagoPanel } from './RepartoPagoPanel'
import type { FilaRepartoEditable } from '../domain/hermes/repartoPago'
import { createUuid } from '../application/shared/createUuid'
import { CobroDestinoField } from './CobroDestinoField'
import { aplicarDestinoCobro, destinoObligatorio, destinoPendiente, useCobroDestino } from './useCobroDestino'
import { paymentAttemptKey, paymentRejected, readPaymentAttempt, type PaymentAttempt } from '../domain/hermes/paymentAttempt'
import { avisarSaldoActualizado } from '../infrastructure/supabase/SaldoCliente.supabase'

const metodoLabels: Record<PosPaymentMethodExt, string> = { cash: 'Efectivo', qr: 'QR', deposit: 'Depósito', transfer: 'Transferencia', sigep: 'SIGEP', check: 'Cheque' }
const metodoOrder: PosPaymentMethodExt[] = ['cash', 'qr', 'deposit', 'transfer', 'sigep', 'check']

// Caja y propuesta de Hermes se registran juntas. La confirmación autorizada es posterior.
export function PagoModal({ onClose, notify = () => undefined }: { onClose: () => void; notify?: (message: string) => void }) {
  const { sessionId } = useCashSession()
  // Brief S5: estable por apertura del modal (no por render), análogo a operationId en
  // PosContext — así un doble click con la red cortada y restablecida reusa la misma
  // clave de idempotencia en vez de crear dos movimiento_caja.
  const pagoOperationId = useRef(createUuid())
  const sending = useRef(false)
  const [actorId, setActorId] = useState<string | null>(null)
  const [identityLoading, setIdentityLoading] = useState(true)
  const [pending, setPending] = useState<PaymentAttempt | null>(null)
  const [referencia, setReferencia] = useState('')
  const [customer, setCustomer] = useState<CustomerRecord | null>(null)
  const integraConciliador = !!customer && customer.type !== 'retail'
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerRecord[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [tipo, setTipo] = useState<'total' | 'pedido'>('total')
  const [orders, setOrders] = useState<PedidoParaCobro[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState('')
  const [ordersRetry, setOrdersRetry] = useState(0)
  const [orderId, setOrderId] = useState<string | undefined>(undefined)
  // `amount` es `undefined` mientras el cajero no tocó el campo — permite distinguir
  // "todavía no escribió nada, así que el saldo lo puede precargar cuando llegue" de
  // "escribió 0 a propósito". Ni bien el cajero toca el NumberField (o el saldo llega y
  // se precarga), pasa a tener un número fijo y ya no se vuelve a pisar.
  const [amount, setAmountState] = useState<number | undefined>(undefined)
  const [method, setMethod] = useState<PosPaymentMethodExt | null>(null)
  const { esEncargado, destino, setDestino } = useCobroDestino()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ amountCents: number; customerName: string; inHermes: boolean; repartoWarning?: string } | null>(null)
  // Brief S4: antes solo se guardaba sinCuenta y se descartaba el saldo — el cajero
  // registraba un pago a ciegas, sin ver cuánto debía el cliente. Ahora se muestra el
  // resultado completo (los mismos cuatro estados de SaldoBadge) y se usa para precargar
  // el monto con lo que el cliente normalmente viene a pagar.
  const [saldo, setSaldo] = useState<ResultadoSaldo | null>(null)
  // Brief T4 Tarea 2: solo aplica cuando tipo === 'total' (un cobro que no corresponde a
  // un solo pedido) — el vendedor puede editar el reparto propuesto antes de confirmar.
  const [repartoFilas, setRepartoFilas] = useState<FilaRepartoEditable[]>([])
  const [repartoError, setRepartoError] = useState<string | null>(null)
  const [repartoContext, setRepartoContext] = useState('')
  const [repartoRetry, setRepartoRetry] = useState(0)
  // Brief T7 Tarea 4: excluyente con el reparto — el vendedor decide reservar el pago como
  // anticipo en vez de dejar que el FIFO se lo coma contra deuda vieja.
  const [noImputar, setNoImputar] = useState(false)

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the previous customer's saldo/monto immediately when customer changes, before the new fetch resolves
    setSaldo(null)
    setAmountState(undefined)
    if (!featureFlags.supabase || !customer || customer.type === 'retail') return
    const id = Number(customer.id)
    if (!Number.isFinite(id) || id <= 0) return
    let cancelled = false
    void consultarSaldo(id).then((result) => { if (!cancelled) setSaldo(result) })
    return () => { cancelled = true }
  }, [customer])

  // El caso normal es "viene a pagar lo que debe": si el cajero no escribió nada todavía
  // y llegó un saldo confirmado positivo, ese es el monto a mostrar — pero derivado en el
  // render, no vía setState sincrónico dentro de un efecto (eso es justo lo que S1 sacó
  // de CustomersPage por el mismo lint react-hooks/set-state-in-effect).
  const selectedOrder = orders.find(o => o.id === orderId)
  const amountPrecargado = tipo === 'pedido' ? selectedOrder?.pendienteBs : saldo?.estado === 'ok' ? Math.max(0, saldo.saldoProvisional) : undefined
  const displayAmount = amount ?? amountPrecargado ?? 0
  const setAmount = (value: number) => setAmountState(value)

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

  useEffect(() => {
    if (tipo !== 'pedido' || !customer) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the order list/selection immediately when tipo or customer changes, before the new fetch (if any) resolves
      setOrders([])
      setOrderId(undefined)
      setOrdersLoading(false)
      setOrdersError('')
      return
    }
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) { setOrders([]); setOrderId(undefined); setOrdersLoading(true); setOrdersError('') } })
    void (featureFlags.supabase ? consultarPedidosCobro(customer.id) : orderService.list().then(items => items.filter(o => o.customerId === customer.id && o.status !== 'cancelled').map(o => ({id:o.id,number:o.number,pendienteBs:(o.totalCents ?? o.lines.reduce((sum,l)=>sum+Math.round(l.quantity*l.unitPriceCents),0))/100})))).then((list) => {
      if (cancelled) return
      setOrders(list)
    }).catch((err: unknown) => {
      if (cancelled) return
      const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
      setOrdersError(code === 'PGRST202' || code === '42883'
        ? 'La consulta de pedidos aún no está habilitada. Falta activar la actualización de la base de datos.'
        : code === '42501'
          ? 'Tu sesión no tiene permiso para consultar pedidos. Revisa el acceso con administración.'
          : 'No se pudieron consultar los pedidos. Reintenta la consulta.')
    })
      .finally(() => { if (!cancelled) setOrdersLoading(false) })
    return () => { cancelled = true }
  }, [tipo, customer, ordersRetry])

  const pickCustomer = (record: CustomerRecord) => { setCustomer(record); setShowCustomerPicker(false); setCustomerQuery(''); setOrderId(undefined); setOrders([]); setNoImputar(false); setRepartoFilas([]); setRepartoContext(''); setRepartoError(null) }
  const changeTipo = (next: 'total' | 'pedido') => { setTipo(next); setOrderId(undefined); setAmountState(undefined); setNoImputar(false); setRepartoContext('') }
  const requiereReparto = tipo === 'total' && integraConciliador && featureFlags.supabase && displayAmount > 0 && !noImputar

  const valid = !!customer && !!method && !!actorId && !identityLoading && !destinoPendiente(esEncargado, method, destino) && Number.isFinite(displayAmount) && Math.round(displayAmount * 100) > 0 && !!sessionId && (tipo === 'total' || (!!selectedOrder && !ordersLoading && !ordersError)) && (!requiereReparto || (repartoContext === `${customer.id}:${displayAmount}` && !repartoError))
  // No bloqueante: pagar de más es legítimo (queda saldo a favor), así que esto es un
  // aviso, no una condición de `valid`.
  const pendienteDestino = tipo === 'pedido' ? selectedOrder?.pendienteBs : saldo?.estado === 'ok' ? Math.max(0, saldo.saldoProvisional) : undefined
  const superaSaldo = pendienteDestino != null && displayAmount > pendienteDestino
    ? displayAmount - pendienteDestino
    : 0

  const confirm = async () => {
    if (sending.current || !actorId || (!pending && !valid)) return
    sending.current = true
    setSubmitting(true)
    setError('')
    try {
      const aplicaciones = requiereReparto ? repartoFilas.filter(f => f.aplica > 0).map(f => ({ partidaId: f.partidaId, monto: f.aplica })) : undefined
      const attempt: PaymentAttempt = pending ?? { operationId: pagoOperationId.current, customer: customer!, orderId: tipo === 'pedido' ? orderId : undefined, amountCents: moneyFromDecimal(displayAmount).cents, method: method!, sessionId: sessionId!, noImputar: tipo === 'total' && (noImputar || (!!aplicaciones && aplicaciones.length === 0)), aplicaciones: aplicaciones?.length ? aplicaciones : undefined, destino: destinoObligatorio(esEncargado, method) ? destino : null, referencia: referencia.trim() }
      localStorage.setItem(paymentAttemptKey(actorId), JSON.stringify(attempt)); setPending(attempt)
      const { operationId: id, customer: client, destino: target, ...payment } = attempt
      const amountCents = attempt.amountCents
      // Brief S5: huella = clienteId | pedidoId | amountCents | method | sessionId — un
      // reintento con exactamente estos mismos datos reusa la clave (un solo movimiento_caja);
      // cambiar el método tras un cobro fallido (brief S5's ejemplo: "el cliente dice pago
      // con QR") da una huella distinta, o sea un pago nuevo, no un reintento del viejo.
      const huella = JSON.stringify(payment)
      const resultado = await sensitiveOperations.ejecutarIdempotente(
        'register_payment',
        id,
        huella,
        (idempotencyKey) => cashService.registerPayment({
          ...payment,
          customerId: client.id,
          idempotencyKey,
        }),
      )
      localStorage.removeItem(paymentAttemptKey(actorId)); setPending(null)
      await aplicarDestinoCobro(target, resultado?.movementId, notify)
      avisarSaldoActualizado(); window.dispatchEvent(new Event('pago-cliente-registrado'))
      setDone({ amountCents, customerName: client.name, inHermes: !!resultado && 'pagoId' in resultado && !!resultado.pagoId })

    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el pago')
      if (paymentRejected(err)) { localStorage.removeItem(paymentAttemptKey(actorId)); setPending(null) }
    } finally {
      setSubmitting(false)
      sending.current = false
    }
  }

  if (done) return <Modal title="Pago registrado" onClose={onClose}><div className="modal-body success-state">
    <span>✓</span>
    <h3>{formatMoney(money(done.amountCents))}</h3>
    <p>{featureFlags.supabase && done.inHermes ? `Registrado en caja y en Hermes para ${done.customerName}. Pendiente de revisión.` : `Pago registrado en caja para ${done.customerName}.`}</p>
    {done.repartoWarning && <p className="mock-note payment-error">{done.repartoWarning}</p>}
  </div><footer className="modal-actions"><button className="primary-button full-button" onClick={onClose}>Cerrar</button></footer></Modal>

  const close = () => { if (!sending.current) onClose() }
  return <Modal title="Registrar pago" subtitle="Cliente → destino del pago → importe y medio" className="payment-account-modal" onClose={close} escapeToClose={!submitting} wide>
  {pending && <div role="status" className="payment-account-pending"><strong>Pago pendiente de comprobar</strong><p>{pending.customer.name} · {formatMoney(money(pending.amountCents))} · {metodoLabels[pending.method]}</p><small>Reutiliza este intento para evitar cobrar dos veces.</small></div>}
  <fieldset disabled={submitting || !!pending || identityLoading} className="modal-body form-grid payment-account-fields">
    <h3 className="full payment-account-step"><span>1</span> Cliente y destino</h3>
    <div className="full">
      <span className="field-label">Cliente</span>
      <div className="customer-search" style={{ marginTop: 5 }}>
        <input
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
    </div>
    <div className="full">
      <span className="field-label">Tipo de pago</span>
      <div className="payment-methods pago-tipo-toggle">
        <button type="button" className={tipo === 'total' ? 'active' : ''} onClick={() => changeTipo('total')}>Sobre el total adeudado</button>
        <button type="button" className={tipo === 'pedido' ? 'active' : ''} onClick={() => changeTipo('pedido')}>Sobre un pedido específico</button>
      </div>
    </div>
    {tipo === 'pedido' && <div className="full">
      <label htmlFor="pago-pedido">Pedido</label>
      <select id="pago-pedido" value={orderId ?? ''} disabled={!customer || ordersLoading || !!ordersError} onChange={(e) => { setOrderId(e.target.value || undefined); setAmountState(undefined) }}>
        <option value="">{customer ? 'Elegí un pedido…' : 'Elegí un cliente primero'}</option>
        {orders.map((o) => <option key={o.id} value={o.id}>{o.number} · Pendiente Bs {o.pendienteBs.toFixed(2)}</option>)}
      </select>
      {ordersLoading ? <small role="status">Consultando pedidos…</small> : ordersError ? <small role="alert">{ordersError}</small> : customer && !orders.length && <small>Este cliente no tiene pedidos pendientes de pago.</small>}
      {ordersError && <button type="button" className="secondary-button" onClick={() => { setOrders([]); setOrderId(undefined); setAmountState(undefined); setOrdersError(''); setOrdersLoading(true); setOrdersRetry(n => n + 1) }}>Reintentar pedidos</button>}
      {selectedOrder && <p className="mock-note">Pendiente de este pedido: {formatMoney(moneyFromDecimal(selectedOrder.pendienteBs))}. El pago se asignará a {selectedOrder.number}; el excedente quedará como anticipo.</p>}
    </div>}
    {integraConciliador && featureFlags.supabase && saldo && <div className="full">{tipo === 'pedido' && <span className="field-label">Saldo total del cliente</span>}<SaldoResumen saldo={saldo} /></div>}
    {customer?.type === 'retail' && <p className="mock-note full">Este pago se registra en Seller. Los clientes retail quedan fuera del conciliador.</p>}
    <h3 className="full payment-account-step"><span>2</span> Importe y distribución</h3>
    <label>Monto (Bs)<NumberField min={0} step={0.01} value={displayAmount} onCommit={setAmount} disabled={tipo === 'pedido' && (!selectedOrder || ordersLoading || !!ordersError)} /></label>
    {/* Brief T7 Tarea 4: excluyente con el reparto de abajo — imputar_pago rechaza la
        combinación del lado servidor, así que acá se apagan mutuamente en la UI. */}
    {tipo === 'total' && integraConciliador && featureFlags.supabase && (
      <label className="full custom-modal-add-another">
        <input
          type="checkbox"
          checked={noImputar}
          onChange={(e) => { setNoImputar(e.target.checked); if (e.target.checked) { setRepartoFilas([]); setRepartoError(null) } }}
        />
        Dejar como anticipo a favor del cliente (no imputar a deudas)
      </label>
    )}
    {noImputar && (
      <p className="mock-note full">El pago no se descontará de partidas abiertas. Queda disponible para imputarlo manualmente después.</p>
    )}
    {/* Brief T4 Tarea 2: solo un pago "sobre el total" puede corresponder a más de una
        partida — un pago atado a un pedido específico ya se resuelve solo (proponer_pago
        le aplica el monto entero a esa partida). */}
    {tipo === 'total' && integraConciliador && customer && featureFlags.supabase && displayAmount > 0 && !noImputar && (
      <RepartoPagoPanel key={`${customer.id}:${repartoRetry}`} clienteId={Number(customer.id)} monto={displayAmount} onFilasChange={(filas, err, context) => { setRepartoFilas(filas); setRepartoError(err); setRepartoContext(context ?? '') }} />
    )}
    {requiereReparto && repartoError && !repartoError.startsWith('Consultando') && <button type="button" className="secondary-button full" onClick={() => { setRepartoContext(''); setRepartoRetry(n => n + 1) }}>Reintentar reparto</button>}
    <h3 className="full payment-account-step"><span>3</span> Medio y respaldo</h3>
    <label>Método de pago<select value={method ?? ''} onChange={(e) => { setMethod((e.target.value || null) as PosPaymentMethodExt | null); setDestino(null) }}>
      <option value="" disabled>Elige un método…</option>
      {metodoOrder.map((m) => <option key={m} value={m}>{metodoLabels[m]}</option>)}
    </select></label>
    <label>Referencia (opcional)<input maxLength={200} value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Número de depósito o comprobante" /></label>
    {destinoObligatorio(esEncargado, method) && <CobroDestinoField value={destino} onChange={setDestino} disabled={submitting} />}
    {featureFlags.supabase && !sessionId && <p className="mock-note">Caja cerrada — abrí la caja para poder registrar un pago.</p>}
    {superaSaldo > 0 && <p className="mock-note">Supera {tipo === 'pedido' ? 'el pendiente del pedido' : 'el saldo'} en {formatMoney(moneyFromDecimal(superaSaldo))} — va a quedar saldo a favor.</p>}
    {error && <p className="mock-note payment-error">{error}</p>}
  </fieldset><footer className="modal-actions"><button className="secondary-button" disabled={submitting} onClick={close}>{pending ? 'Cerrar y conservar intento' : 'Cancelar'}</button><button className="primary-button" disabled={identityLoading || (!pending && !valid) || submitting} onClick={() => void confirm()}>{submitting ? 'Registrando…' : pending ? 'Comprobar el mismo pago' : 'Confirmar pago'}</button></footer></Modal>
}

// Mismos cuatro estados que SaldoBadge (Brief S4) — acá se muestran como una línea de
// texto arriba del monto, no como badge, porque este modal ya trae su propio contexto
// de cliente y no necesita el ícono/chip compacto.
function SaldoResumen({ saldo }: { saldo: ResultadoSaldo }) {
  if (saldo.estado === 'no-disponible') return <p className="mock-note">Saldo no disponible.</p>
  if (saldo.estado === 'sin-cuenta') return <p className="mock-note">Se abrirá su cuenta en Hermes al registrar el pago.</p>
  const { saldoConfirmado, saldoProvisional } = saldo
  if (saldoConfirmado === 0 && saldoProvisional === 0) return <p className="mock-note">Cliente al día.</p>
  // Misma regla que SaldoBadge: si lo provisional es 0, el pago ya viajó a Hermes y no
  // hay que reclamar nada, aunque el confirmado todavía no baje.
  if (saldoProvisional === 0) return <p className="mock-note">{formatMoney(moneyFromDecimal(Math.abs(saldoConfirmado)))} en revisión en Hermes.</p>
  const debe = saldoProvisional > 0
  const enRevision = saldoConfirmado !== saldoProvisional
  return (
    <p className={`mock-note ${debe ? 'payment-error' : ''}`}>
      {debe ? 'Debe' : 'Saldo a favor'}: {formatMoney(moneyFromDecimal(Math.abs(saldoProvisional)))}
      {enRevision && ` · ${formatMoney(moneyFromDecimal(Math.abs(saldoConfirmado - saldoProvisional)))} en revisión`}
    </p>
  )
}
