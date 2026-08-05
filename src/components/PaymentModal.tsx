import { Banknote, CreditCard, QrCode, Shuffle, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { usePos } from '../context/PosContext'
import { Modal } from './Modal'
import { featureFlags } from '../config/featureFlags'
import { useCashSession } from '../context/CashSessionContext'
import { saleService, authSessionProvider } from '../infrastructure/services'
import type { SaleCheckoutPayment } from '../application/ports/repositories'
import { registrarCargoSaldo, HermesHttpError } from '../infrastructure/hermes/client'
import { pendienteSyncHermesRepository } from '../infrastructure/supabase/PendienteSyncHermesRepository'
import { netUnitPriceCents } from '../domain/sales/ventaPricing'
import { NumberField } from './NumberField'

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
  const { cart, discount, total, newOperation, customer, operationId } = usePos()
  const { sessionId } = useCashSession()
  // Crédito has no metodo_pago equivalent in the real backend; only shown in mock mode.
  const methods = allMethods.filter((m) => m.id !== 'credito' || (featureFlags.credit && !featureFlags.supabase))
  const [method, setMethod] = useState('efectivo')
  const [received, setReceived] = useState(total)
  const [mixedCash, setMixedCash] = useState(0)
  const [mixedMethod, setMixedMethod] = useState<'qr' | 'transferencia'>('qr')
  const [mixedDigital, setMixedDigital] = useState(total)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ saleId: string; totalCents: number; isRetry: boolean } | null>(null)
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

  const buildPayments = (): SaleCheckoutPayment[] => {
    if (method === 'mixto') {
      const payments: SaleCheckoutPayment[] = []
      if (mixedCash > 0) payments.push({ method: 'cash', amountCents: Math.round(mixedCash * 100) })
      if (mixedDigital > 0) payments.push({ method: posMethod(mixedMethod), amountCents: Math.round(mixedDigital * 100) })
      return payments
    }
    return [{ method: posMethod(method), amountCents: Math.round(total * 100) }]
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
        payments: buildPayments(),
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
      setResult({ saleId: checkout.saleId, totalCents: checkout.totalCents, isRetry: checkout.isRetry === true })
      setDone(true)
      // TAREA 4 (Tanda 3): el caché de stock de origen del carrito (CartPanel's originStock)
      // no se invalidaba nunca — vendías 5 de 5 unidades, volvías a agregar el producto y
      // seguía diciendo que había 5. Se invalida entero acá, apenas la venta se confirma.
      onCheckoutSuccess?.()
      void syncHermesCargo(checkout.saleId, checkout.totalCents)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la venta')
    } finally {
      setSubmitting(false)
    }
  }

  const confirm = () => { if (featureFlags.supabase) void confirmSupabase(); else setDone(true) }

  if (done) return <Modal title="¡Cobro confirmado!" subtitle={featureFlags.supabase ? (result ? `Venta #${result.saleId}` : undefined) : "Operación completada localmente"} onClose={() => { newOperation(); onClose() }}><div className="success-state"><span>✓</span><h3>Bs {money(featureFlags.supabase && result ? result.totalCents / 100 : total)}</h3><p>{
    // Si el cajero reintentó tras una respuesta perdida, registrar_venta detectó la
    // misma clave de idempotencia y no creó una segunda venta — hay que decirlo
    // explícitamente o el cajero va a creer que cobró dos veces.
    featureFlags.supabase
      ? (result?.isRetry ? `Esta venta ya estaba registrada (#${result.saleId}). No se cobró dos veces.` : 'Venta registrada en el backend.')
      : 'Esta es una simulación. No se registró ningún pago real.'
  }</p>{cargoResult && cargoResult.cubiertoPorSaldo && <p className="saldo-cubierto-msg">Cubierto con saldo a favor. Saldo restante: Bs {money(cargoResult.saldoResultante)}</p>}</div><footer className="modal-actions"><button className="primary-button full-button" onClick={() => { newOperation(); onClose() }}>Finalizar y nueva operación</button></footer></Modal>

  return <Modal title="Registrar cobro" subtitle="Selecciona un método de pago" onClose={onClose} wide><div className="payment-total"><span>Total a cobrar</span><strong>Bs {money(total)}</strong></div><div className="modal-body"><label className="field-label">Método de pago</label><div className="payment-methods">{methods.map(({ id, label, icon: Icon }) => <button key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}><Icon /><span>{label}</span></button>)}</div>{method === 'mixto' ? <><div className="mixed-fields"><label>Efectivo (Bs)<NumberField min={0} step={0.01} value={mixedCash} onCommit={setMixedCash} /></label><label>{mixedMethod === 'qr' ? 'QR' : 'Transferencia'} (Bs)<div className="mixed-method-row"><select value={mixedMethod} onChange={(e) => setMixedMethod(e.target.value as 'qr' | 'transferencia')}><option value="qr">QR</option><option value="transferencia">Transferencia</option></select><NumberField min={0} step={0.01} value={mixedDigital} onCommit={setMixedDigital} /></div></label></div><div className={`mixed-status ${paymentValid ? 'valid' : ''}`}><span>Suma del pago</span><strong>Bs {money(mixedSum)}</strong><small>{paymentValid ? 'El monto coincide con el total' : `Faltan Bs ${money(Math.max(0, total - mixedSum))}`}</small></div></> : <div className="payment-fields"><label>Monto recibido (Bs)<NumberField min={0} step={0.01} value={received} onCommit={setReceived} /></label><div><span>{method === 'efectivo' ? 'Cambio' : 'Diferencia'}</span><strong>Bs {money(method === 'efectivo' ? Math.max(0, received - total) : Math.max(0, total - received))}</strong></div></div>}{!featureFlags.supabase && <p className="mock-note">Modo demostración: el pago no tendrá efecto contable ni movimiento de caja.</p>}{featureFlags.supabase && !sessionId && <p className="mock-note">Caja cerrada — abrí la caja para poder cobrar.</p>}{error && <p className="mock-note payment-error">{error}</p>}</div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!paymentValid || submitting || (featureFlags.supabase && !sessionId)} onClick={confirm}>{submitting ? 'Procesando…' : 'Confirmar cobro'}</button></footer></Modal>
}
