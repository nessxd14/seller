import { Banknote, CreditCard, Printer, QrCode, Shuffle, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePos } from '../context/PosContext'
import { Modal } from './Modal'
import { featureFlags } from '../config/featureFlags'
import { useCashSession } from '../context/CashSessionContext'
import { saleService, authSessionProvider, turnoService } from '../infrastructure/services'
import type { SaleCheckoutPayment } from '../application/ports/repositories'
import { registrarCargoSaldo, HermesHttpError } from '../infrastructure/hermes/client'
import { pendienteSyncHermesRepository } from '../infrastructure/supabase/PendienteSyncHermesRepository'
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

export function PaymentModal({ onClose, onCheckoutSuccess }: { onClose: () => void; onCheckoutSuccess?: () => void }) {
  const { cart, discount, total, newOperation, customer, operationId, notifyVentaCompletada } = usePos()
  const { sessionId } = useCashSession()
  // Crédito has no metodo_pago equivalent in the real backend; only shown in mock mode.
  const methods = allMethods.filter((m) => m.id !== 'credito' || (featureFlags.credit && !featureFlags.supabase))
  const [method, setMethod] = useState('efectivo')
  const [received, setReceived] = useState(total)
  const [mixedCash, setMixedCash] = useState(0)
  // Brief Caja-1 B1: "un pequeño campo Recibido junto a la porción de efectivo" del
  // pago mixto — 0 significa "no se cargó", así que no se manda receivedCents (ver
  // buildPayments) y el backend simplemente no valida nada contra ese pago.
  const [mixedCashRecibido, setMixedCashRecibido] = useState(0)
  const [mixedMethod, setMixedMethod] = useState<'qr' | 'transferencia'>('qr')
  const [mixedDigital, setMixedDigital] = useState(total)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ saleId: string; numero?: string; totalCents: number; isRetry: boolean } | null>(null)
  const [cambioBs, setCambioBs] = useState<number | null>(null)
  const [ticketOpen, setTicketOpen] = useState(false)
  // Resultado del cargo a saldo de Hermes (registrado en segundo plano tras confirmar la
  // venta) — undefined mientras está en curso o no aplica, null si falló (encolado para
  // reintento), un objeto si se cubrió con saldo a favor.
  // OJO al reactivar hermesCargoVenta: saldoResultante viene de
  // v_saldo_cliente.saldo_confirmado con la convención de Hermes (positivo =
  // deuda), así que "Saldo restante: Bs {saldoResultante}" imprime un número
  // negativo o cero cuando cubierto_por_saldo es true. Corregir junto con el
  // resto del flujo de crédito, no antes.
  const [cargoResult, setCargoResult] = useState<{ cubiertoPorSaldo: boolean; saldoResultante: number } | null | undefined>(undefined)
  const mixedSum = Math.round((mixedCash + mixedDigital + Number.EPSILON) * 100) / 100
  const paymentValid = method === 'mixto' ? Math.abs(mixedSum - total) < 0.005 : received >= total

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
    if (method === 'mixto') {
      const payments: SaleCheckoutPayment[] = []
      if (mixedCash > 0) payments.push({ method: 'cash', amountCents: Math.round(mixedCash * 100), ...(mixedCashRecibido > 0 ? { receivedCents: Math.round(mixedCashRecibido * 100) } : {}) })
      if (mixedDigital > 0) payments.push({ method: posMethod(mixedMethod), amountCents: Math.round(mixedDigital * 100) })
      return payments
    }
    // Brief Caja-1 A2: "recibido" solo tiene sentido en efectivo — para QR/transferencia/
    // crédito el campo de arriba muestra "Diferencia", no "Cambio", y no se manda.
    return [{ method: posMethod(method), amountCents: Math.round(total * 100), ...(method === 'efectivo' ? { receivedCents: Math.round(received * 100) } : {}) }]
  }

  // La venta ya está confirmada en Supabase cuando esto corre — un fallo acá nunca revierte
  // la venta, solo encola un reintento en pendiente_sync_hermes.
  const syncHermesCargo = async (saleId: string, totalCents: number) => {
    if (!featureFlags.hermesCargoVenta) return
    if (!customer?.id) return
    setCargoResult(undefined)
    const monto = totalCents / 100
    let usuarioPos = customer.name
    try {
      const session = await authSessionProvider.getSession()
      usuarioPos = session?.user.email ?? session?.user.id ?? usuarioPos
    } catch {
      // sin sesión disponible, se usa el nombre del cliente como último recurso
    }
    try {
      const cargo = await registrarCargoSaldo({ clienteId: Number(customer.id), monto, ventaId: saleId, usuarioPos })
      setCargoResult({ cubiertoPorSaldo: cargo.cubiertoPorSaldo, saldoResultante: cargo.saldoResultante })
    } catch (err) {
      setCargoResult(null)
      // Un 403 es un permiso denegado — reintentar nunca va a funcionar, así que no
      // tiene sentido encolarlo en pendiente_sync_hermes junto a fallos de red que sí
      // ameritan reintento. Queda solo el registro en consola para diagnóstico.
      if (err instanceof HermesHttpError && err.status === 403) {
        console.error('registrarCargoSaldo: permiso denegado (403), no se encola reintento:', err.message)
        return
      }
      try {
        await pendienteSyncHermesRepository.registrarFallo({
          ventaId: saleId,
          clienteId: customer.id,
          monto,
          usuarioPos,
          error: err instanceof Error ? err.message : 'No se pudo registrar el cargo en Hermes',
        })
      } catch {
        // si ni siquiera se pudo encolar el reintento, no hay más que hacer acá — la venta
        // ya está confirmada y es lo que importa
      }
    }
  }

  const confirmSupabase = async () => {
    if (!sessionId) { setError('No hay una sesión de caja abierta. Abrí la caja para poder cobrar.'); return }
    setSubmitting(true)
    setError('')
    try {
      const payments = buildPayments()
      const checkout = await saleService.checkout({
        lines: cart.map((item) => ({
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
        cashSessionId: sessionId,
        discountCents: Math.round(discount * 100),
        // TAREA 4: NIT/cliente is always optional — customer may be null ("Cliente de
        // mostrador") or missing an id if selection somehow failed; either way checkout
        // must never be blocked on it.
        customerId: customer?.id,
        // Estable por pestaña/operación (sobrevive a un F5); combinado con la huella del
        // contenido del cobro del lado del servicio, es lo que permite que un reintento
        // tras una respuesta perdida reuse la misma clave de idempotencia, y que un
        // carrito editado tras un fallo genere una venta nueva en vez de perderse.
        operationId,
      })
      // La venta se confirma primero, siempre — el cargo a saldo de Hermes es un paso
      // posterior que nunca bloquea ni revierte una venta ya confirmada.
      setResult({ saleId: checkout.saleId, numero: checkout.numero, totalCents: checkout.totalCents, isRetry: checkout.isRetry === true })
      setCambioBs(
        method === 'efectivo' ? Math.max(0, received - total)
          : method === 'mixto' && mixedCashRecibido > 0 ? Math.max(0, mixedCashRecibido - mixedCash)
            : null,
      )
      // Brief Caja-2 B3: /end 'completada' apenas registrar_venta confirma, antes de
      // decidir si esta venta queda retenida (B1) o va directo a la pantalla confirmada
      // — la auditoría de DVR ya no tiene nada que ver con eso.
      notifyVentaCompletada({ numero: checkout.numero, totalBs: checkout.totalCents / 100 })
      // TAREA 4 (Tanda 3): el caché de stock de origen del carrito (CartPanel's originStock)
      // no se invalidaba nunca — vendías 5 de 5 unidades, volvías a agregar el producto y
      // seguía diciendo que había 5. Se invalida entero acá, apenas la venta se confirma.
      onCheckoutSuccess?.()
      void syncHermesCargo(checkout.saleId, checkout.totalCents)

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
  }</p>{cargoResult && cargoResult.cubiertoPorSaldo && <p className="saldo-cubierto-msg">Cubierto con saldo a favor. Saldo restante: Bs {money(cargoResult.saldoResultante)}</p>}</div><footer className="modal-actions">{featureFlags.supabase && result && <button className="secondary-button" onClick={() => setTicketOpen(true)}><Printer /> Imprimir ticket</button>}<button className="primary-button full-button" onClick={() => { newOperation(); onClose() }}>Finalizar y nueva operación</button></footer>{ticketOpen && result && <VentaTicket id={result.saleId} onClose={() => setTicketOpen(false)} />}</Modal>

  return <Modal title="Registrar cobro" subtitle="Selecciona un método de pago" onClose={onClose} wide><div className="payment-total"><span>Total a cobrar</span><strong>Bs {money(total)}</strong></div><div className="modal-body"><label className="field-label">Método de pago</label><div className="payment-methods">{methods.map(({ id, label, icon: Icon }) => <button key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}><Icon /><span>{label}</span></button>)}</div>{method === 'mixto' ? <><div className="mixed-fields"><label>Efectivo (Bs)<NumberField min={0} step={0.01} value={mixedCash} onCommit={setMixedCash} /></label><label>Recibido en efectivo (Bs)<NumberField min={0} step={0.01} value={mixedCashRecibido} onCommit={setMixedCashRecibido} /></label><label>{mixedMethod === 'qr' ? 'QR' : 'Transferencia'} (Bs)<div className="mixed-method-row"><select value={mixedMethod} onChange={(e) => setMixedMethod(e.target.value as 'qr' | 'transferencia')}><option value="qr">QR</option><option value="transferencia">Transferencia</option></select><NumberField min={0} step={0.01} value={mixedDigital} onCommit={setMixedDigital} /></div></label></div><div className={`mixed-status ${paymentValid ? 'valid' : ''}`}><span>Suma del pago</span><strong>Bs {money(mixedSum)}</strong><small>{paymentValid ? 'El monto coincide con el total' : `Faltan Bs ${money(Math.max(0, total - mixedSum))}`}</small></div></> : <div className="payment-fields"><label>Monto recibido (Bs)<NumberField min={0} step={0.01} value={received} onCommit={setReceived} /></label><div><span>{method === 'efectivo' ? 'Cambio' : 'Diferencia'}</span><strong>Bs {money(method === 'efectivo' ? Math.max(0, received - total) : Math.max(0, total - received))}</strong></div></div>}{!featureFlags.supabase && <p className="mock-note">Modo demostración: el pago no tendrá efecto contable ni movimiento de caja.</p>}{featureFlags.supabase && !sessionId && <p className="mock-note">Caja cerrada — abrí la caja para poder cobrar.</p>}{error && <p className="mock-note payment-error">{error}</p>}</div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button data-pos-action="confirm-payment" className="primary-button" disabled={!paymentValid || submitting || (featureFlags.supabase && !sessionId)} onClick={confirm}>{submitting ? 'Procesando…' : 'Confirmar cobro'}</button></footer></Modal>
}
