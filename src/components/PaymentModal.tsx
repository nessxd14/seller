import { Banknote, CreditCard, Printer, QrCode, Shuffle, Smartphone, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePos } from '../context/PosContext'
import { Modal } from './Modal'
import { featureFlags } from '../config/featureFlags'
import { useCashSession } from '../context/CashSessionContext'
import { saleService, turnoService } from '../infrastructure/services'
import type { SaleCheckoutPayment } from '../application/ports/repositories'
import { useSaldoCliente } from '../hooks/useSaldoCliente'
import { checkoutFingerprint } from '../domain/sales/checkoutFingerprint'
import { avisarSaldoActualizado } from '../infrastructure/supabase/SaldoCliente.supabase'
import { netUnitPriceCents } from '../domain/sales/ventaPricing'
import { NumberField } from './NumberField'
import { VentaTicket } from './VentaTicket'

// Brief Caja-2 B1: pasado este umbral sin VERIFICADO, se le ofrece al cajero seguir
// esperando o dejar la venta retenida (QR pendiente en "Mis tickets").
const QR_HOLD_TIMEOUT_S = 90
const QR_HOLD_POLL_MS = 3000

const allMethods = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote },
  { id: 'qr', label: 'QR', icon: QrCode },
  { id: 'transferencia', label: 'Transferencia', icon: Smartphone },
  { id: 'credito', label: 'Crédito', icon: CreditCard },
  { id: 'mixto', label: 'Pago mixto', icon: Shuffle },
]
const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const posMethod = (id: string): 'cash' | 'qr' | 'transfer' => (id === 'qr' ? 'qr' : id === 'transferencia' ? 'transfer' : 'cash')

interface PendingBalancePayment { context: string; cashSessionId: string; balanceCents: number; payments: SaleCheckoutPayment[] }
function readPendingBalance(key: string): PendingBalancePayment | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as PendingBalancePayment | null
    return value && typeof value.context === 'string' && typeof value.cashSessionId === 'string' && Number.isSafeInteger(value.balanceCents) && value.balanceCents > 0 && Array.isArray(value.payments)
      && value.payments.every(p => ['cash','qr','transfer'].includes(p.method) && Number.isSafeInteger(p.amountCents) && p.amountCents > 0) ? value : null
  } catch { return null }
}

export function PaymentModal({ onClose, onCheckoutSuccess }: { onClose: () => void; onCheckoutSuccess?: () => void }) {
  const { cart, discount, total, newOperation, customer, operationId, notifyVentaCompletada } = usePos()
  const { sessionId } = useCashSession()
  const pendingKey = `roari-saldo-cobro:${operationId}`
  const [pendingBalance, setPendingBalance] = useState(() => readPendingBalance(pendingKey))
  const checkoutSessionId = pendingBalance?.cashSessionId ?? sessionId
  const paymentContext = checkoutFingerprint({ lines: cart.map(item => ({ productId: String(item.id), quantity: item.cantidad, unitPriceCents: netUnitPriceCents(item), sourceLocation: item.ubicacion, presentacionId: item.presentacionId, description: item.nombre, isCustomItem: item.isCustomItem, unitOfMeasure: item.unidadMedida })), payments: [], cashSessionId: checkoutSessionId ?? '', customerId: customer?.id, discountCents: Math.round(discount * 100) })
  const pendingChanged = !!pendingBalance && pendingBalance.context !== paymentContext
  // Crédito has no metodo_pago equivalent in the real backend; only shown in mock mode.
  const methods = allMethods.filter((m) => m.id !== 'credito' || (featureFlags.credit && !featureFlags.supabase))
  const [method, setMethod] = useState('efectivo')
  const { saldo, loading: saldoLoading, error: saldoError, refresh: refreshSaldo } = useSaldoCliente(customer?.id)
  const [useBalance, setUseBalance] = useState(true)
  const [balanceInput, setBalanceInput] = useState<number | null>(null)
  const maximumBalanceCents = Math.min(Math.round((saldo?.disponible ?? 0) * 100), Math.round(total * 100))
  const balanceCents = pendingBalance?.balanceCents ?? (useBalance ? Math.max(0, Math.min(maximumBalanceCents, Math.round((balanceInput ?? maximumBalanceCents / 100) * 100))) : 0)
  const amountDue = (Math.round(total * 100) - balanceCents) / 100
  const [receivedInput, setReceived] = useState<number | null>(null)
  const received = receivedInput ?? amountDue
  const [mixedCash, setMixedCash] = useState(0)
  // Brief Caja-1 B1: "un pequeño campo Recibido junto a la porción de efectivo" del
  // pago mixto — 0 significa "no se cargó", así que no se manda receivedCents (ver
  // buildPayments) y el backend simplemente no valida nada contra ese pago.
  const [mixedCashRecibido, setMixedCashRecibido] = useState(0)
  const [mixedMethod, setMixedMethod] = useState<'qr' | 'transferencia'>('qr')
  const [mixedDigitalInput, setMixedDigital] = useState<number | null>(null)
  const mixedDigital = mixedDigitalInput ?? Math.max(0, amountDue - mixedCash)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ saleId: string; numero?: string; totalCents: number; isRetry: boolean; balanceAppliedCents: number; balanceRemainingCents?: number } | null>(null)
  const [cambioBs, setCambioBs] = useState<number | null>(null)
  const [ticketOpen, setTicketOpen] = useState(false)
  const mixedSum = Math.round((mixedCash + mixedDigital + Number.EPSILON) * 100) / 100
  const paymentValid = pendingBalance ? !pendingChanged : amountDue === 0 || (method === 'mixto' ? Math.abs(mixedSum - amountDue) < 0.005 : method === 'efectivo' ? received >= amountDue : Math.abs(received - amountDue) < 0.005)

  // Brief Caja-2 B1: mientras el banco está en línea, una venta retail con QR queda
  // "Esperando confirmación del QR…" en vez de ir directo a la pantalla confirmada.
  // null = sin retención (venta sin QR, banco offline, o ya verificada/vencida).
  const [holdPhase, setHoldPhase] = useState<'esperando' | 'vencida' | null>(null)
  const [holdElapsedS, setHoldElapsedS] = useState(0)
  const [holdQrAmountCents, setHoldQrAmountCents] = useState(0)
  const [bankOfflineNotice, setBankOfflineNotice] = useState(false)

  // Brief Caja-2 B1: mientras se espera, un poll cada 3 s a venta_pago.estado_verificacion
  // — hasta VERIFICADO (pasa a la pantalla confirmada) o hasta los 90 s (ofrece seguir
  // esperando / dejar retenida).
  useEffect(() => {
    if (holdPhase !== 'esperando' || !result) return
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setHoldElapsedS(elapsed)
      if (elapsed >= QR_HOLD_TIMEOUT_S) { setHoldPhase('vencida'); return }
      void turnoService.estadoPagoQr(result.saleId)
        .then((estado) => { if (estado === 'VERIFICADO') { setHoldPhase(null); setDone(true) } })
        .catch(() => { /* red caída — se sigue esperando, el próximo tick reintenta */ })
    }, QR_HOLD_POLL_MS)
    return () => window.clearInterval(interval)
  }, [holdPhase, result])

  const buildPayments = (): SaleCheckoutPayment[] => {
    if (pendingBalance) return pendingBalance.payments
    if (amountDue === 0) return []
    if (method === 'mixto') {
      const payments: SaleCheckoutPayment[] = []
      if (mixedCash > 0) payments.push({ method: 'cash', amountCents: Math.round(mixedCash * 100), ...(mixedCashRecibido > 0 ? { receivedCents: Math.round(mixedCashRecibido * 100) } : {}) })
      if (mixedDigital > 0) payments.push({ method: posMethod(mixedMethod), amountCents: Math.round(mixedDigital * 100) })
      return payments
    }
    // Brief Caja-1 A2: "recibido" solo tiene sentido en efectivo — para QR/transferencia/
    // crédito el campo de arriba muestra "Diferencia", no "Cambio", y no se manda.
    return [{ method: posMethod(method), amountCents: Math.round(amountDue * 100), ...(method === 'efectivo' ? { receivedCents: Math.round(received * 100) } : {}) }]
  }

  const confirmSupabase = async () => {
    if (submitting || !paymentValid || pendingChanged) return
    if (!checkoutSessionId) { setError('No hay una sesión de caja abierta. Abrí la caja para poder cobrar.'); return }
    setSubmitting(true)
    setError('')
    try {
      const payments = buildPayments()
      if (balanceCents > 0) {
        const attempt = { context: paymentContext, cashSessionId: checkoutSessionId, balanceCents, payments }
        localStorage.setItem(pendingKey, JSON.stringify(attempt))
        setPendingBalance(attempt)
      }
      const checkout = await saleService.checkout({
        lines: cart.map((item) => item.isCustomItem ? {
          // Ítem personalizado: sin producto, presentación ni origen — el id negativo del
          // carrito nunca debe llegar al RPC.
          productId: '',
          isCustomItem: true,
          description: item.nombre,
          unitOfMeasure: item.unidadMedida,
          quantity: item.cantidad,
          unitPriceCents: netUnitPriceCents(item),
          listPriceCents: Math.round(item.precioAplicado * 100),
        } : ({
          productId: String(item.id),
          quantity: item.cantidad,
          unitPriceCents: netUnitPriceCents(item),
          // precio de lista SIN descuento — habilita venta_linea.precio_modificado
          // (columna GENERATED: precio_unitario <> precio_lista).
          listPriceCents: Math.round(item.precioAplicado * 100),
          sourceLocation: item.ubicacion,
          presentacionId: item.presentacionId,
        })),
        payments,
        cashSessionId: checkoutSessionId,
        discountCents: Math.round(discount * 100),
        // TAREA 4: NIT/cliente is always optional — customer may be null ("Cliente de
        // mostrador") or missing an id if selection somehow failed; either way checkout
        // must never be blocked on it.
        customerId: customer?.id,
        balanceCents,
        // Estable por pestaña/operación (sobrevive a un F5); combinado con la huella del
        // contenido del cobro del lado del servicio, es lo que permite que un reintento
        // tras una respuesta perdida reuse la misma clave de idempotencia, y que un
        // carrito editado tras un fallo genere una venta nueva en vez de perderse.
        operationId,
      })
      localStorage.removeItem(pendingKey)
      setResult({ saleId: checkout.saleId, numero: checkout.numero, totalCents: checkout.totalCents, isRetry: checkout.isRetry === true, balanceAppliedCents: 'balanceAppliedCents' in checkout ? Number(checkout.balanceAppliedCents ?? 0) : 0, balanceRemainingCents: 'balanceRemainingCents' in checkout ? Number(checkout.balanceRemainingCents) : undefined })
      const cashPayment = payments.find(p => p.method === 'cash')
      setCambioBs(cashPayment?.receivedCents != null ? Math.max(0, cashPayment.receivedCents - cashPayment.amountCents) / 100 : null)
      // Brief Caja-2 B3: /end 'completada' apenas registrar_venta confirma, antes de
      // decidir si esta venta queda retenida (B1) o va directo a la pantalla confirmada
      // — la auditoría de DVR ya no tiene nada que ver con eso.
      notifyVentaCompletada({ numero: checkout.numero, totalBs: checkout.totalCents / 100 })
      // TAREA 4 (Tanda 3): el caché de stock de origen del carrito (CartPanel's originStock)
      // no se invalidaba nunca — vendías 5 de 5 unidades, volvías a agregar el producto y
      // seguía diciendo que había 5. Se invalida entero acá, apenas la venta se confirma.
      onCheckoutSuccess?.()
      avisarSaldoActualizado()

      // Brief Caja-2 B1 (decisión 24): scope retail-only (este modal solo se usa en el
      // Cobrar de Venta, nunca en Mayoreo ni VTD) — con un pago QR y el banco en línea,
      // se retiene el ticket hasta VERIFICADO en vez de ir directo a la pantalla
      // confirmada. Sin QR en el pago, o banco offline/caído, nunca se retiene: un
      // scraper caído no puede frenar al cajero.
      const qrAmountCents = payments.filter((p) => p.method === 'qr').reduce((sum, p) => sum + p.amountCents, 0)
      if (qrAmountCents > 0) {
        setHoldQrAmountCents(qrAmountCents)
        try {
          const estado = await turnoService.estadoBancoQr()
          if (estado.enLinea) {
            setHoldElapsedS(0)
            setHoldPhase('esperando')
            return
          }
          setBankOfflineNotice(true)
        } catch {
          setBankOfflineNotice(true)
        }
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la venta')
      // Un rechazo SQL explícito revierte la transacción. Una respuesta de red perdida
      // puede corresponder a una venta confirmada: conservar su reparto al reintentar.
      if (/^(P0001|42501|22\w{3}|23\w{3})$/.test(String((err as { code?: string })?.code ?? ''))) {
        localStorage.removeItem(pendingKey); setPendingBalance(null)
      }
      void refreshSaldo()
    } finally {
      setSubmitting(false)
    }
  }

  const confirm = () => { if (featureFlags.supabase) void confirmSupabase(); else setDone(true) }

  // Brief hotkeys — Tarea 5: Enter confirma el cobro, pero solo pasando por el mismo
  // botón que un clic usaría — así el botón deshabilitado (caja cerrada, pago inválido,
  // envío en curso) sigue bloqueando el atajo exactamente igual que bloquea el clic.
  // Enter dentro de un <textarea> conserva su comportamiento nativo (no hay ninguno en
  // este modal hoy, pero la guarda es la misma que el resto del POS usa).
  useEffect(() => {
    if (done) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.target instanceof HTMLTextAreaElement) return
      const button = document.querySelector<HTMLButtonElement>('[data-pos-action="confirm-payment"]')
      if (!button || button.disabled) return
      event.preventDefault()
      button.click()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [done])

  // Brief Caja-2 B1: "Esperando confirmación del QR…" — el ticket queda retenido hasta
  // VERIFICADO (o hasta que el cajero, pasados 90 s, elija seguir esperando o dejar la
  // venta retenida). Nunca bloquea si el banco está offline — eso se resuelve arriba,
  // en confirmSupabase, antes de llegar acá.
  if (holdPhase === 'esperando' || holdPhase === 'vencida') {
    const dejarRetenida = () => { newOperation(); onClose() }
    return <Modal title="Esperando confirmación del QR…" subtitle={result?.numero ? `Ticket ${result.numero}` : undefined} onClose={dejarRetenida}>
      <div className="success-state qr-hold-state">
        <p>Monto QR: Bs {money(holdQrAmountCents / 100)}</p>
        <p className="qr-hold-elapsed">{holdElapsedS}s</p>
        {holdPhase === 'vencida' && <>
          <p className="mock-note">No se recibió confirmación del banco todavía.</p>
          <p className="qr-hold-warning">No entregues la mercadería hasta que el gerente confirme el pago.</p>
        </>}
      </div>
      <footer className="modal-actions">
        {holdPhase === 'vencida'
          ? <><button className="secondary-button" onClick={() => { setHoldElapsedS(0); setHoldPhase('esperando') }}>Seguir esperando</button><button className="primary-button full-button" onClick={dejarRetenida}>Dejar retenida</button></>
          : <button className="secondary-button full-button" onClick={dejarRetenida}>Dejar retenida</button>}
      </footer>
    </Modal>
  }

  if (done) return <Modal title="¡Cobro confirmado!" subtitle={featureFlags.supabase ? (result ? `Venta #${result.saleId}` : undefined) : "Operación completada localmente"} onClose={() => { newOperation(); onClose() }}><div className="success-state"><span>✓</span>
    {/* Brief Caja-1 B1: el número de ticket real (VTA-2026-NNNNN), asignado por
        _registrar_venta_nucleo — no confundir con operationNumber (contador por
        pestaña en sessionStorage, nunca un número de documento). */}
    {featureFlags.supabase && result?.numero && <p className="ticket-numero-hero">Ticket N° <strong>{result.numero}</strong></p>}
    <h3>Bs {money(featureFlags.supabase && result ? result.totalCents / 100 : total)}</h3>
    {cambioBs != null && cambioBs > 0 && <p>Cambio: Bs {money(cambioBs)}</p>}
    {/* Brief Caja-2 B1: banco offline no frena al cajero — imprime igual, con el
        (pendiente) de siempre en el ticket, y el gerente lo verifica después. */}
    {bankOfflineNotice && <p className="qr-offline-notice">Banco sin conexión: el QR queda pendiente y lo verifica el gerente.</p>}
    <p>{
    // Si el cajero reintentó tras una respuesta perdida, registrar_venta detectó la
    // misma clave de idempotencia y no creó una segunda venta — hay que decirlo
    // explícitamente o el cajero va a creer que cobró dos veces.
    featureFlags.supabase
      ? (result?.isRetry ? `Esta venta ya estaba registrada (#${result.saleId}). No se cobró dos veces.` : 'Venta registrada en el backend.')
      : 'Esta es una simulación. No se registró ningún pago real.'
  }</p>{result && result.balanceAppliedCents > 0 && <div className="credit-payment-summary"><strong>Saldo a favor aplicado: Bs {money(result.balanceAppliedCents / 100)}</strong><span>Dinero nuevo: Bs {money((result.totalCents - result.balanceAppliedCents) / 100)}</span>{result.balanceRemainingCents != null && <span>Saldo a favor restante: Bs {money(result.balanceRemainingCents / 100)}</span>}</div>}</div><footer className="modal-actions">{featureFlags.supabase && result && <button className="secondary-button" onClick={() => setTicketOpen(true)}><Printer /> Imprimir ticket</button>}<button className="primary-button full-button" onClick={() => { newOperation(); onClose() }}>Finalizar y nueva operación</button></footer>{ticketOpen && result && <VentaTicket id={result.saleId} onClose={() => setTicketOpen(false)} />}</Modal>

  return <Modal title="Registrar cobro" subtitle={customer?.name ?? 'Cliente de mostrador'} onClose={() => { if (!submitting) onClose() }} wide>
    <div className="payment-total"><span>Total de la venta</span><strong>Bs {money(total)}</strong></div>
    <div className="modal-body">
      {!pendingBalance && saldoLoading && <p role="status">Consultando saldo del cliente…</p>}
      {!pendingBalance && saldoError && <p className="mock-note" role="status">No se pudo verificar el saldo a favor. Puedes cobrar la venta completa o volver a consultar. <button type="button" disabled={submitting} onClick={() => void refreshSaldo()}>Consultar saldo</button></p>}
      {pendingBalance && <section className="credit-payment-summary"><strong>Cobro pendiente de comprobar</strong><span>Saldo aplicado en el intento: Bs {money(pendingBalance.balanceCents / 100)}</span><p>El reintento conserva el importe y los métodos originales, aunque el saldo disponible haya cambiado.</p>{pendingBalance.payments.map((p, i) => <span key={i}>{p.method === 'cash' ? 'Efectivo' : p.method === 'qr' ? 'QR' : 'Transferencia'}: Bs {money(p.amountCents / 100)}</span>)}</section>}
      {pendingChanged && <p className="payment-error" role="alert">El carrito cambió y tiene un cobro con saldo sin comprobar. Revisa el ticket en Caja antes de iniciar otra operación.</p>}
      {!pendingBalance && maximumBalanceCents > 0 && <section className="credit-payment-option" aria-label="Usar saldo a favor">
        <label className="credit-use-toggle"><input type="checkbox" checked={useBalance} disabled={submitting} onChange={e => setUseBalance(e.target.checked)} /><Wallet /><span><strong>Usar saldo a favor confirmado</strong><small>Disponible: Bs {money(saldo?.disponible ?? 0)}</small></span></label>
        {useBalance && <label>Saldo que se aplicará (Bs)<NumberField min={0} max={maximumBalanceCents / 100} step={0.01} value={balanceCents / 100} disabled={submitting} onCommit={setBalanceInput} /></label>}
        <p>Este importe ya pertenece al cliente. No es un nuevo ingreso de caja.</p>
      </section>}
      <div className="credit-amount-due"><span>Dinero nuevo por cobrar</span><strong>Bs {money(amountDue)}</strong></div>
      {amountDue > 0 && !pendingBalance ? <fieldset className="payment-entry-fields" disabled={submitting}>
        <legend>Método de pago de la diferencia</legend>
        <div className="payment-methods">{methods.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}><Icon /><span>{label}</span></button>)}</div>
        {method === 'mixto' ? <><div className="mixed-fields"><label>Efectivo (Bs)<NumberField min={0} step={0.01} value={mixedCash} onCommit={setMixedCash} /></label><label>Recibido en efectivo (Bs)<NumberField min={0} step={0.01} value={mixedCashRecibido} onCommit={setMixedCashRecibido} /></label><label>{mixedMethod === 'qr' ? 'QR' : 'Transferencia'} (Bs)<div className="mixed-method-row"><select value={mixedMethod} onChange={e => setMixedMethod(e.target.value as 'qr' | 'transferencia')}><option value="qr">QR</option><option value="transferencia">Transferencia</option></select><NumberField min={0} step={0.01} value={mixedDigital} onCommit={setMixedDigital} /></div></label></div><div className={`mixed-status ${paymentValid ? 'valid' : ''}`}><span>Suma del dinero nuevo</span><strong>Bs {money(mixedSum)}</strong><small>{paymentValid ? 'El monto coincide con la diferencia' : `Debe coincidir con Bs ${money(amountDue)}`}</small></div></> : <div className="payment-fields"><label>Monto recibido (Bs)<NumberField min={0} step={0.01} value={received} onCommit={setReceived} /></label><div><span>{method === 'efectivo' ? 'Cambio' : 'Diferencia'}</span><strong>Bs {money(method === 'efectivo' ? Math.max(0, received - amountDue) : Math.max(0, amountDue - received))}</strong></div></div>}
      </fieldset> : amountDue === 0 ? <p className="saldo-cubierto-msg" role="status">La compra se cubre por completo con saldo a favor. No recibas dinero adicional.</p> : null}
      {!featureFlags.supabase && <p className="mock-note">Modo demostración: el pago no tendrá efecto contable ni movimiento de caja.</p>}
      {featureFlags.supabase && !sessionId && <p className="mock-note">Caja cerrada — abrí la caja para poder registrar la venta.</p>}
      {error && <p className="mock-note payment-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-actions"><button className="secondary-button" disabled={submitting} onClick={onClose}>Cancelar</button><button data-pos-action="confirm-payment" className="primary-button" disabled={!paymentValid || submitting || (!pendingBalance && saldoLoading) || (featureFlags.supabase && !checkoutSessionId)} onClick={confirm}>{submitting ? 'Procesando…' : pendingBalance ? 'Comprobar cobro anterior' : amountDue === 0 ? 'Confirmar con saldo a favor' : 'Confirmar cobro'}</button></footer>
  </Modal>
}
