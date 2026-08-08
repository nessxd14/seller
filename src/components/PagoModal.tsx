import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { NumberField } from './NumberField'
import { customerService, orderService, cashService, authSessionProvider, sensitiveOperations } from '../infrastructure/services'
import { useCashSession } from '../context/CashSessionContext'
import { featureFlags } from '../config/featureFlags'
import { consultarSaldo, registrarPago, type ResultadoSaldo } from '../infrastructure/hermes/client'
import { pendienteSyncHermesPagoRepository } from '../infrastructure/supabase/PendienteSyncHermesPagoRepository'
import { methodExtToMedioHermes, type PosPaymentMethodExt } from '../infrastructure/supabase/mappers'
import { formatMoney, money, moneyFromDecimal } from '../domain/common/money'
import type { CustomerRecord, OrderView } from '../application/shared/models'

const metodoLabels: Record<PosPaymentMethodExt, string> = { cash: 'Efectivo', qr: 'QR', deposit: 'Depósito', transfer: 'Transferencia', sigep: 'SIGEP', check: 'Cheque' }
const metodoOrder: PosPaymentMethodExt[] = ['cash', 'qr', 'deposit', 'transfer', 'sigep', 'check']

// "Registrar pago" — el cajero cobra al instante, dentro de su sesión de caja abierta,
// igual que una venta. Del lado de Hermes el pago queda PROPUESTO hasta que un supervisor
// (rol gerente, en Hermes) lo confirme — pero eso no es cosa del cajero ni de esta
// pantalla: nunca se menciona acá, ni se bloquea ni se revierte el pago del POS por eso.
export function PagoModal({ onClose }: { onClose: () => void }) {
  const { sessionId } = useCashSession()
  // Brief S5: estable por apertura del modal (no por render), análogo a operationId en
  // PosContext — así un doble click con la red cortada y restablecida reusa la misma
  // clave de idempotencia en vez de crear dos movimiento_caja.
  const pagoOperationId = useRef(crypto.randomUUID())
  const [customer, setCustomer] = useState<CustomerRecord | null>(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerRecord[]>([])
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [tipo, setTipo] = useState<'total' | 'pedido'>('total')
  const [orders, setOrders] = useState<OrderView[]>([])
  const [orderId, setOrderId] = useState<string | undefined>(undefined)
  // `amount` es `undefined` mientras el cajero no tocó el campo — permite distinguir
  // "todavía no escribió nada, así que el saldo lo puede precargar cuando llegue" de
  // "escribió 0 a propósito". Ni bien el cajero toca el NumberField (o el saldo llega y
  // se precarga), pasa a tener un número fijo y ya no se vuelve a pisar.
  const [amount, setAmountState] = useState<number | undefined>(undefined)
  const [method, setMethod] = useState<PosPaymentMethodExt>('cash')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ amountCents: number; customerName: string } | null>(null)
  // Brief S4: antes solo se guardaba sinCuenta y se descartaba el saldo — el cajero
  // registraba un pago a ciegas, sin ver cuánto debía el cliente. Ahora se muestra el
  // resultado completo (los mismos cuatro estados de SaldoBadge) y se usa para precargar
  // el monto con lo que el cliente normalmente viene a pagar.
  const [saldo, setSaldo] = useState<ResultadoSaldo | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the previous customer's saldo/monto immediately when customer changes, before the new fetch resolves
    setSaldo(null)
    setAmountState(undefined)
    if (!featureFlags.supabase || !customer) return
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
  const amountPrecargado = saldo?.estado === 'ok' && saldo.saldoConfirmado > 0 ? saldo.saldoConfirmado : undefined
  const displayAmount = amount ?? amountPrecargado ?? 0
  const setAmount = (value: number) => setAmountState(value)

  useEffect(() => {
    if (!showCustomerPicker) return
    let cancelled = false
    const handle = setTimeout(() => {
      void customerService.list({ query: customerQuery, page: { page: 1, pageSize: 8 } }).then((list) => { if (!cancelled) setCustomerResults(list) })
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [showCustomerPicker, customerQuery])

  useEffect(() => {
    if (tipo !== 'pedido' || !customer) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the order list/selection immediately when tipo or customer changes, before the new fetch (if any) resolves
      setOrders([])
      setOrderId(undefined)
      return
    }
    let cancelled = false
    void orderService.list().then((list) => {
      if (cancelled) return
      setOrders(list.filter((o) => o.customerId === customer.id && o.status !== 'delivered' && o.status !== 'cancelled'))
    })
    return () => { cancelled = true }
  }, [tipo, customer])

  const pickCustomer = (record: CustomerRecord) => { setCustomer(record); setShowCustomerPicker(false); setCustomerQuery('') }

  const valid = !!customer && displayAmount > 0 && !!sessionId && (tipo === 'total' || !!orderId)
  // No bloqueante: pagar de más es legítimo (queda saldo a favor), así que esto es un
  // aviso, no una condición de `valid`.
  const superaSaldo = saldo?.estado === 'ok' && saldo.saldoConfirmado > 0 && displayAmount > saldo.saldoConfirmado
    ? displayAmount - saldo.saldoConfirmado
    : 0

  // Puente hacia Hermes: siempre en segundo plano, best-effort. El pago del POS ya quedó
  // confirmado antes de que esto corra — un fallo acá solo encola un reintento.
  const syncHermesPago = async (movimientoCajaId: string, clienteId: string, amountCents: number, metodo: PosPaymentMethodExt, pedidoId: string | undefined) => {
    if (!featureFlags.supabase) return
    let usuarioPos = 'pos'
    try {
      const session = await authSessionProvider.getSession()
      usuarioPos = session?.user.email ?? session?.user.id ?? usuarioPos
    } catch {
      // sin sesión disponible, se usa el fallback
    }
    const medio = methodExtToMedioHermes(metodo)
    try {
      await registrarPago({ clienteId: Number(clienteId), monto: amountCents / 100, medio, pedidoId, movimientoCajaId, usuarioPos })
    } catch (err) {
      try {
        await pendienteSyncHermesPagoRepository.registrarFallo({
          movimientoCajaId,
          clienteId,
          pedidoId,
          monto: amountCents / 100,
          metodo: medio,
          usuarioPos,
          error: err instanceof Error ? err.message : 'No se pudo registrar el pago en Hermes',
        })
      } catch {
        // si ni siquiera se pudo encolar el reintento, no hay más que hacer acá — el pago
        // ya está confirmado en el POS y es lo que importa
      }
    }
  }

  const confirm = async () => {
    if (!customer || !sessionId) return
    setSubmitting(true)
    setError('')
    try {
      const amountCents = moneyFromDecimal(displayAmount).cents
      const orderIdForPayment = tipo === 'pedido' ? orderId : undefined
      // Brief S5: huella = clienteId | pedidoId | amountCents | method | sessionId — un
      // reintento con exactamente estos mismos datos reusa la clave (un solo movimiento_caja);
      // cambiar el método tras un cobro fallido (brief S5's ejemplo: "el cliente dice pago
      // con QR") da una huella distinta, o sea un pago nuevo, no un reintento del viejo.
      const huella = [customer.id, orderIdForPayment ?? '', amountCents, method, sessionId].join('|')
      const { movementId } = await sensitiveOperations.ejecutarIdempotente(
        'register_payment',
        pagoOperationId.current,
        huella,
        (idempotencyKey) => cashService.registerPayment({
          customerId: customer.id,
          orderId: orderIdForPayment,
          amountCents,
          method,
          sessionId,
          idempotencyKey,
        }),
      )
      setDone({ amountCents, customerName: customer.name })
      void syncHermesPago(movementId, customer.id, amountCents, method, orderIdForPayment)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el pago')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return <Modal title="Pago registrado" onClose={onClose}><div className="modal-body success-state">
    <span>✓</span>
    <h3>{formatMoney(money(done.amountCents))}</h3>
    <p>Pago registrado. {formatMoney(money(done.amountCents))} anotado en la cuenta de {done.customerName}.</p>
  </div><footer className="modal-actions"><button className="primary-button full-button" onClick={onClose}>Cerrar</button></footer></Modal>

  return <Modal title="Registrar pago" subtitle="Pago de un cliente sobre su cuenta" onClose={onClose} wide><div className="modal-body form-grid">
    <div className="full">
      <span className="field-label">Cliente</span>
      <div className="customer-search" style={{ marginTop: 5 }}>
        <input
          value={showCustomerPicker ? customerQuery : (customer?.name ?? '')}
          placeholder="Buscar cliente por nombre, documento o correo..."
          onFocus={() => setShowCustomerPicker(true)}
          onChange={(e) => { setCustomerQuery(e.target.value); setShowCustomerPicker(true) }}
        />
        {showCustomerPicker && (
          <div className="customer-search-results">
            {customerResults.map((c) => <button type="button" key={c.id} onClick={() => pickCustomer(c)}><strong>{c.name}</strong><small>{c.document} · {c.usualChannel}</small></button>)}
            {!customerResults.length && <span className="empty-hint">Sin resultados.</span>}
            <button type="button" className="close-picker" onClick={() => setShowCustomerPicker(false)}>Cerrar</button>
          </div>
        )}
      </div>
    </div>
    <div className="full">
      <span className="field-label">Tipo de pago</span>
      <div className="payment-methods pago-tipo-toggle">
        <button type="button" className={tipo === 'total' ? 'active' : ''} onClick={() => setTipo('total')}>Sobre el total adeudado</button>
        <button type="button" className={tipo === 'pedido' ? 'active' : ''} onClick={() => setTipo('pedido')}>Sobre un pedido específico</button>
      </div>
    </div>
    {tipo === 'pedido' && <label className="full">
      Pedido
      <select value={orderId ?? ''} disabled={!customer} onChange={(e) => setOrderId(e.target.value || undefined)}>
        <option value="">{customer ? 'Elegí un pedido…' : 'Elegí un cliente primero'}</option>
        {orders.map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}
      </select>
      {customer && !orders.length && <small className="line-stock-error">Este cliente no tiene pedidos abiertos.</small>}
    </label>}
    {customer && featureFlags.supabase && saldo && <SaldoResumen saldo={saldo} />}
    <label>Monto (Bs)<NumberField autoFocus min={0} step={0.01} value={displayAmount} onCommit={setAmount} /></label>
    <label>Método de pago<select value={method} onChange={(e) => setMethod(e.target.value as PosPaymentMethodExt)}>
      {metodoOrder.map((m) => <option key={m} value={m}>{metodoLabels[m]}</option>)}
    </select></label>
    {featureFlags.supabase && !sessionId && <p className="mock-note">Caja cerrada — abrí la caja para poder registrar un pago.</p>}
    {superaSaldo > 0 && <p className="mock-note">Supera el saldo en {formatMoney(moneyFromDecimal(superaSaldo))} — va a quedar saldo a favor.</p>}
    {error && <p className="mock-note payment-error">{error}</p>}
  </div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid || submitting} onClick={() => void confirm()}>{submitting ? 'Registrando…' : 'Confirmar pago'}</button></footer></Modal>
}

// Mismos cuatro estados que SaldoBadge (Brief S4) — acá se muestran como una línea de
// texto arriba del monto, no como badge, porque este modal ya trae su propio contexto
// de cliente y no necesita el ícono/chip compacto.
function SaldoResumen({ saldo }: { saldo: ResultadoSaldo }) {
  if (saldo.estado === 'no-disponible') return <p className="mock-note">Saldo no disponible.</p>
  if (saldo.estado === 'sin-cuenta') return <p className="mock-note">Este cliente todavía no tiene cuenta corriente en Hermes. El pago se va a registrar en caja igual, pero no va a aparecer en su estado de cuenta hasta que se lo importe en Hermes.</p>
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
