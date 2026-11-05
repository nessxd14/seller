import { AlertTriangle, Ban, HandCoins, Minus, Printer, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { VtdTicketPreviewModal } from '../../components/VtdTicketPreviewModal'
import { CobrarVtdPaymentModal } from '../../components/CobrarVtdPaymentModal'
import { AnularVentaModal } from '../../components/AnularVentaModal'
import { AjusteVtdModal, type AjusteVtdPayload } from '../../components/AjusteVtdModal'
import { RechazoVtdModal, type RechazoVtdData } from '../../components/RechazoVtdModal'
import { useCajaAlmacen } from '../../context/CajaAlmacenContext'
import { entregaPendiente, faltanteTexto, vtdEstadoLabels, type CajaAlmacenVtd, type VtdCajaAlmacenInfo } from '../../application/shared/cajaAlmacen'
import '../../styles/caja-almacen.css'
import { usePuedeAnular } from '../../components/usePuedeAnular'
import { mensajeAnulacion, type AnularVentaResultado } from '../../domain/sales/anulacion'
import { useCobroVtd } from './useCobroVtd'
import { useCashSession } from '../../context/CashSessionContext'
import { ventaDirectaService } from '../../infrastructure/services'
import type { VentaDirectaRecord, VtdPorCobrar } from '../../application/shared/models'
import type { SaleCheckoutPayment } from '../../application/ports/repositories'
import { antiguedadMinutos, esErrorAutorizacion, VTD_ANTIGUEDAD_AVISO_MIN } from '../../domain/sales/vtd'

const money = (cents: number) => (cents / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Brief VTD 2.4/2.5 — bandeja de VTD abiertos, acotada al turno de caja actual ("vida útil
 * = el turno" — un VTD huérfano de turno cerrado ya no lo puede tocar el cajero desde acá,
 * pasa a requerir gerente). Pestaña propia dentro de Ventas (B2), no mezclada con Pedidos.
 */
export function VentaDirectaPage({ notify }: { notify: (message: string) => void }) {
  const { sessionId } = useCashSession()
  if (!sessionId) return <FeatureShell eyebrow="ALMACÉN" title="Venta Directa" subtitle="Ventas abiertas de este turno de caja"><FeatureState type="empty" text="Abrí la caja para ver la bandeja de venta directa" /></FeatureShell>
  return <VentaDirectaBandeja key={sessionId} sessionId={sessionId} notify={notify} />
}

function VentaDirectaBandeja({ sessionId, notify }: { sessionId: string; notify: (message: string) => void }) {
  const [ventas, setVentas] = useState<VentaDirectaRecord[] | null>(null)
  const [ajustando, setAjustando] = useState<VentaDirectaRecord | null>(null)
  const [ticketing, setTicketing] = useState<VentaDirectaRecord | null>(null)
  const [anulando, setAnulando] = useState<VentaDirectaRecord | null>(null)
  const puedeAnular = usePuedeAnular()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cobrando, setCobrando] = useState<VtdPorCobrar | null>(null)
  const [pagoPosterior, setPagoPosterior] = useState<VentaDirectaRecord | null>(null)
  // Cómo está cada VTD en Caja–Almacén: decide qué RPC usa cada botón.
  const [info, setInfo] = useState<Map<string, VtdCajaAlmacenInfo>>(new Map())
  const [otrosTurnos, setOtrosTurnos] = useState<VtdPorCobrar[]>([])
  const [ajusteOperacion, setAjusteOperacion] = useState<VentaDirectaRecord | null>(null)
  const [rechazando, setRechazando] = useState<VentaDirectaRecord | null>(null)
  const [accionBusy, setAccionBusy] = useState(false)
  const [accionError, setAccionError] = useState('')
  const almacen = useCajaAlmacen()
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const requests = useRef({ active: true, sequence: 0 })
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    const state = requests.current
    if (!state.active) return
    const current = ++state.sequence
    setRefreshing(true)
    try {
      const [abiertas, porCobrar] = await Promise.all([ventaDirectaService.listAbiertas(sessionId), ventaDirectaService.listPorCobrar()])
      const ajenas = porCobrar.filter((v) => !abiertas.some((a) => a.id === v.ventaId))
      const filas = await ventaDirectaService.infoCajaAlmacen([...abiertas.map((v) => v.id), ...ajenas.map((v) => v.ventaId)])
      if (!state.active || current !== state.sequence) return
      const mapa = new Map(filas.map((f) => [f.ventaId, f]))
      setInfo(mapa)
      setVentas(abiertas)
      // Entregadas con pago posterior, o sin cobrar de un turno ya cerrado. Las de otro turno abierto son de su cajero.
      setOtrosTurnos(ajenas.filter((v) => v.estado === 'COMPLETADA' || (mapa.get(v.ventaId)?.cajaAlmacen && !mapa.get(v.ventaId)?.turnoAbierto)))
      setLoadError('')
    } catch (error) {
      if (state.active && current === state.sequence) setLoadError(error instanceof Error ? error.message : 'No se pudo actualizar la bandeja')
    } finally {
      if (state.active && current === state.sequence) setRefreshing(false)
    }
  }, [sessionId])
  useEffect(() => {
    const state = requests.current
    state.active = true
    void Promise.resolve().then(load)
    const refreshVisible = () => { if (document.visibilityState !== 'hidden') void load() }
    const timer = setInterval(refreshVisible, 60000)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      state.active = false
      ++state.sequence
      clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [load])
  // Refresca la antigüedad mostrada cada 30s — es solo un aviso visual, no re-fetchea.
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id) }, [])

  const cobro = useCobroVtd({ sessionId, notify })
  // La operación activa del carrito puede cambiar desde aquí (una VTD se separa o se rechaza).
  const refrescar = () => {
    void load()
    void almacen.refresh().catch(() => {})
  }
  const confirmarCobro = async (venta: VtdPorCobrar, payments: SaleCheckoutPayment[]) => {
    if (await cobro.cobrar([venta.ventaId], payments, { cajaAlmacen: !!info.get(venta.ventaId)?.cajaAlmacen })) {
      setCobrando(null)
      refrescar()
    }
  }
  const accionOperacion = async (accion: () => Promise<void>, mensaje: string, cerrar: () => void) => {
    if (accionBusy) return
    setAccionBusy(true)
    setAccionError('')
    try {
      await accion()
      notify(mensaje)
      cerrar()
      refrescar()
    } catch (error) {
      setAccionError(error instanceof Error ? error.message : 'No se pudo completar la acción')
    } finally {
      setAccionBusy(false)
    }
  }
  const ajustarEnOperacion = (venta: VentaDirectaRecord, payload: AjusteVtdPayload) =>
    accionOperacion(() => ventaDirectaService.ajustarVtdBandeja(venta.id, payload.lineas, payload.motivo, payload.devolucion), `${venta.numero} ajustada`, () => setAjusteOperacion(null))
  const rechazarEnOperacion = (venta: VentaDirectaRecord, data: RechazoVtdData) =>
    accionOperacion(() => ventaDirectaService.rechazarVtdBandeja(venta.id, data.motivo, data.devolucion_realizada, data.referencia), `${venta.numero} rechazada`, () => setRechazando(null))

  const manejarError = (error: unknown, accion: string) => {
    if (esErrorAutorizacion(error)) {
      notify(error instanceof Error ? error.message : `No autorizado para ${accion}`)
    } else {
      notify(error instanceof Error ? error.message : `No se pudo ${accion}`)
    }
  }

  const consultarEntrega = async (venta: VentaDirectaRecord) => {
    setBusyId(venta.id)
    try {
      const [actual, filas] = await Promise.all([ventaDirectaService.getById(venta.id), ventaDirectaService.infoCajaAlmacen([venta.id])])
      if (!actual) throw new Error('No se encontró la venta directa')
      const entrega = filas[0]?.entrega
      notify(actual.estado === 'COMPLETADA'
        ? `${venta.numero}: Almacén ya autorizó la salida`
        : actual.estado === 'ANULADA'
          ? `${venta.numero} está anulada`
          : entrega === 'EN_CAJA'
            ? `${venta.numero}: Almacén ya envió el material a Caja`
            : filas[0]?.faltante
              ? `${venta.numero}: Almacén reportó faltante. Ajusta la venta`
              : `${venta.numero}: pendiente de autorizar la salida en Almacén`)
      await load()
    } catch (error) {
      manejarError(error, 'consultar la entrega')
    } finally {
      setBusyId(null)
    }
  }

  // Anular (Ness/gerente) o solicitar la anulación (resto) pasa por AnularVentaModal: motivo obligatorio,
  // y los errores de la base —incluidos los de Caja–Almacén— se muestran ahí tal cual.
  const terminarAnulacion = (venta: VentaDirectaRecord, result: AnularVentaResultado) => {
    notify(mensajeAnulacion(venta.numero, result))
    setAnulando(null)
    void load()
  }

  if (ventas === null) return <FeatureShell eyebrow="ALMACÉN" title="Venta Directa" subtitle="Ventas abiertas de este turno de caja">{loadError ? <><p role="alert">{loadError}</p><button disabled={refreshing} onClick={() => void load()}>Reintentar</button></> : <FeatureState type="skeleton" text="Cargando…" />}</FeatureShell>

  return (
    <FeatureShell eyebrow="ALMACÉN" title="Venta Directa" subtitle="Caja registra el cobro. Almacén verifica y autoriza la salida.">
      <button className="secondary-button" disabled={refreshing} onClick={() => void load()}><RefreshCw size={12} /> {refreshing ? 'Actualizando…' : 'Actualizar bandeja'}</button>
      {loadError && <p role="alert">{loadError}</p>}
      {!ventas.length
        ? <FeatureState type="empty" text="No hay ventas directas abiertas en este turno" />
        : <div className="vtd-bandeja-cards">
            {ventas.map((venta) => {
              const antiguedad = antiguedadMinutos(venta.creadoEn)
              const vieja = antiguedad >= VTD_ANTIGUEDAD_AVISO_MIN
              const pagado = venta.paidCents > 0
              // El cobro y la entrega son pasos independientes; Almacén autoriza la salida.
              const estadoAlmacen = info.get(venta.id)
              const enOperacion = !!estadoAlmacen?.cajaAlmacen
              const pendiente = entregaPendiente(estadoAlmacen)
              const exigible = !pagado && venta.cobroExigible && venta.totalCents > 0
              // En Caja–Almacén también se puede cobrar una VTD marcada con pago posterior si el cliente paga antes.
              const porCobrar = exigible && (enOperacion ? pendiente : !venta.pagoPosterior)
              const puedePagoPosterior = exigible && !venta.pagoPosterior && (!enOperacion || pendiente)
              const puedeAjustar = !enOperacion || estadoAlmacen?.entrega === 'SOLICITADO'
              return (
                <article className={`vtd-card ${vieja ? 'vtd-card-vieja' : ''}`} key={venta.id}>
                  <div className="vtd-card-top">
                    <strong>{venta.numero}</strong>
                    {/* Brief Caja VTD: un VTD histórico (previo a la migración, sin pago) nunca
                        se regulariza acá — "POR COBRAR" prometería una acción que no existe
                        para él. cobroExigible=false es la única señal, nunca se recalcula. */}
                    {pagado
                      ? <span className="vtd-modo-tag pagado">PAGADO</span>
                      : venta.pagoPosterior
                        ? <span className="vtd-modo-tag pago-posterior">PAGO POSTERIOR</span>
                        : venta.cobroExigible
                          ? <span className="vtd-modo-tag por-cobrar">POR COBRAR</span>
                          : <span className="vtd-modo-tag vtd-modo-historica">Histórica</span>}
                  </div>
                  {venta.pagoPosterior && !pagado && <p className="vtd-card-pago-posterior"><strong>{venta.pagoPosteriorMotivo}</strong>{venta.pagoPosteriorContacto && <span>Se lleva: {venta.pagoPosteriorContacto}</span>}</p>}
                  {vieja && <p className="vtd-card-aviso"><AlertTriangle size={11} /> Abierta hace {antiguedad} min</p>}
                  {estadoAlmacen?.entrega && <p className="vtd-card-entrega">{vtdEstadoLabels[estadoAlmacen.entrega]}</p>}
                  {estadoAlmacen?.entrega === 'SOLICITADO' && estadoAlmacen.faltante && <strong className="caja-almacen-faltante" role="status">{faltanteTexto(estadoAlmacen)}. Ajusta la VTD</strong>}
                  <ul className="vtd-card-lines">
                    {venta.lines.map((line) => <li key={line.id}>{line.cantidadPresentacion} × {line.name}{line.presentacionNombre ? ` (${line.presentacionNombre})` : ''}</li>)}
                  </ul>
                  <div className="vtd-card-total"><span>Total</span><strong>Bs {money(venta.totalCents)}</strong></div>
                  <div className="vtd-card-actions">
                    <button disabled={busyId === venta.id} onClick={() => setTicketing(venta)}><Printer size={12} /> Ticket</button>
                    {puedeAjustar && <button disabled={busyId === venta.id} onClick={() => { setAccionError(''); if (enOperacion) setAjusteOperacion(venta); else setAjustando(venta) }}><Minus size={12} /> Ajustar</button>}
                    {porCobrar && <button className="primary-button vtd-card-cobrar" disabled={busyId === venta.id} onClick={() => { cobro.clearError(); setCobrando(aPorCobrar(venta)) }}><HandCoins size={12} /> Cobrar</button>}
                    {puedePagoPosterior && <button className="vtd-card-pago-posterior-btn" disabled={busyId === venta.id} onClick={() => setPagoPosterior(venta)}>Pago posterior…</button>}
                    {enOperacion && pendiente && <button disabled={busyId === venta.id} onClick={() => { setAccionError(''); setRechazando(venta) }}>Rechazar</button>}
                    <button className="vtd-card-completar" disabled={busyId === venta.id} onClick={() => void consultarEntrega(venta)}><RefreshCw size={12} /> Consultar entrega</button>
                    <button className="danger-button" disabled={busyId === venta.id} onClick={() => setAnulando(venta)}><Ban size={12} /> {puedeAnular ? 'Anular' : 'Solicitar anulación'}</button>
                  </div>
                </article>
              )
            })}
          </div>}
      {otrosTurnos.length > 0 && <section className="vtd-otros-turnos" aria-label="Por cobrar de otros turnos">
        <h3>Por cobrar de otros turnos</h3>
        <div className="vtd-bandeja-cards">
          {otrosTurnos.map((v) => (
            <article className="vtd-card" key={v.ventaId}>
              <div className="vtd-card-top"><strong>{v.numero ?? `#${v.ventaId}`}</strong><span className={`vtd-modo-tag ${v.pagoPosterior ? 'pago-posterior' : 'por-cobrar'}`}>{v.pagoPosterior ? 'PAGO POSTERIOR' : 'POR COBRAR'}</span></div>
              {v.clienteNombre && <p className="vtd-card-entrega">{v.clienteNombre}</p>}
              {v.pagoPosterior && <p className="vtd-card-pago-posterior"><strong>{v.pagoPosteriorMotivo}</strong>{v.pagoPosteriorContacto && <span>Se lleva: {v.pagoPosteriorContacto}</span>}</p>}
              <div className="vtd-card-total"><span>Total</span><strong>Bs {money(Math.round(v.totalBs * 100))}</strong></div>
              <div className="vtd-card-actions"><button className="primary-button vtd-card-cobrar" onClick={() => { cobro.clearError(); setCobrando(v) }}><HandCoins size={12} /> Cobrar</button></div>
            </article>
          ))}
        </div>
      </section>}
      {ajustando && <AjustarVentaModal venta={ajustando} onClose={() => setAjustando(null)} onDone={() => { setAjustando(null); load() }} notify={notify} />}
      {anulando && <AnularVentaModal venta={{ id: anulando.id, numero: anulando.numero, total: anulando.totalCents / 100, cobrado: anulando.paidCents / 100 }} puedeAnular={puedeAnular} nota="Si pasó por Caja–Almacén, el sistema te indicará cómo resolverla." onDone={(result) => terminarAnulacion(anulando, result)} onClose={() => setAnulando(null)} />}
      {ticketing && <VtdTicketPreviewModal venta={ticketing} onClose={() => setTicketing(null)} />}
      {ajusteOperacion && <AjusteVtdModal vtd={aCajaAlmacenVtd(ajusteOperacion, info.get(ajusteOperacion.id))} paid={ajusteOperacion.paidCents > 0} busy={accionBusy} error={accionError} onCancel={() => setAjusteOperacion(null)} onConfirm={(payload) => ajustarEnOperacion(ajusteOperacion, payload)} />}
      {rechazando && <RechazoVtdModal ventaNumero={rechazando.numero} paid={rechazando.paidCents > 0} busy={accionBusy} error={accionError} onCancel={() => setRechazando(null)} onConfirm={(data) => rechazarEnOperacion(rechazando, data)} />}
      {cobrando && <CobrarVtdPaymentModal ventas={[cobrando]} submitting={cobro.submitting} error={cobro.error} onClose={() => { cobro.clearError(); setCobrando(null) }} onConfirm={(payments) => void confirmarCobro(cobrando, payments)} />}
      {pagoPosterior && <PagoPosteriorModal venta={pagoPosterior} cajaAlmacen={!!info.get(pagoPosterior.id)?.cajaAlmacen} onClose={() => setPagoPosterior(null)} onDone={() => { notify(`${pagoPosterior.numero} marcada como pago posterior`); setPagoPosterior(null); refrescar() }} />}
      {cobro.ticketQueue.length > 0 && <VtdTicketPreviewModal venta={cobro.ticketQueue[0]} onClose={cobro.closeTicket} />}
    </FeatureShell>
  )
}

const aPorCobrar = (venta: VentaDirectaRecord): VtdPorCobrar => ({
  ventaId: venta.id, numero: venta.numero, estado: 'ABIERTA', clienteId: venta.customerId, clienteNombre: venta.customerName,
  totalBs: venta.totalCents / 100, pagoPosterior: venta.pagoPosterior, pagoPosteriorMotivo: venta.pagoPosteriorMotivo,
  pagoPosteriorContacto: venta.pagoPosteriorContacto, creadoPor: venta.creadoPor, creadoEn: venta.creadoEn, sesionCreacionId: venta.sesionCajaId,
})

const aCajaAlmacenVtd = (venta: VentaDirectaRecord, info?: VtdCajaAlmacenInfo): CajaAlmacenVtd => ({
  venta_id: Number(venta.id), numero: venta.numero, total: venta.totalCents / 100, cliente_id: venta.customerId ? Number(venta.customerId) : null,
  cliente: venta.customerName ?? null, estado: info?.entrega ?? 'SOLICITADO', version: info?.version ?? 0, faltante: info?.faltante ?? null, lineas: info?.lineas ?? [],
})

/** Entrega sin cobro (vtd_pago_posterior o marcar_vtd_pago_posterior): motivo siempre; contacto solo si la venta no tiene cliente. */
export function PagoPosteriorModal({ venta, cajaAlmacen = false, onClose, onDone }: { venta: VentaDirectaRecord; cajaAlmacen?: boolean; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [contacto, setContacto] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const contactoRequerido = !venta.customerId
  const valido = motivo.trim().length >= 5 && (!contactoRequerido || contacto.trim().length >= 3)
  const confirmar = async () => {
    if (!valido || submitting) return
    setSubmitting(true)
    setError('')
    try {
      if (cajaAlmacen) await ventaDirectaService.pagoPosteriorVtdBandeja(venta.id, motivo.trim(), contacto.trim() || undefined)
      else await ventaDirectaService.marcarPagoPosterior(venta.id, motivo.trim(), contacto.trim() || undefined)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar el pago posterior')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Modal title={`Pago posterior — ${venta.numero}`} subtitle="La mercadería se entrega sin cobrar. Queda registrado quién se la lleva." onClose={() => { if (!submitting) onClose() }}>
      <div className="modal-body form-grid">
        <label className="full">Motivo<textarea rows={2} value={motivo} disabled={submitting} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se entrega sin cobrar (mínimo 5 caracteres)" /></label>
        <label className="full">Quién se lleva la mercadería (nombre y teléfono){contactoRequerido ? '' : ' — opcional'}<input type="text" value={contacto} disabled={submitting} onChange={(e) => setContacto(e.target.value)} placeholder="Ej.: Carlos Pérez · 7000000" /></label>
        {error && <p role="alert" className="mock-note payment-error full">{error}</p>}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" disabled={submitting} onClick={onClose}>Cancelar</button>
        <button className="primary-button" disabled={!valido || submitting} onClick={() => void confirmar()}>{submitting ? 'Guardando…' : 'Marcar pago posterior'}</button>
      </footer>
    </Modal>
  )
}

/**
 * Brief 2.5: "solo se reduce" (steppers topan en la cantidad original) y "todo a cero está
 * prohibido — la UI debe detectar ese caso antes de llamar y ofrecer directamente el botón
 * de anular". Una línea individual en cero sí se permite.
 */
function AjustarVentaModal({ venta, onClose, onDone, notify }: { venta: VentaDirectaRecord; onClose: () => void; onDone: () => void; notify: (message: string) => void }) {
  const [cantidades, setCantidades] = useState<Record<string, number>>(() => Object.fromEntries(venta.lines.map((l) => [l.id, l.cantidadPresentacion])))
  const [motivo, setMotivo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const dejaTodoEnCero = Object.values(cantidades).every((v) => v === 0)
  const huboCambio = venta.lines.some((l) => cantidades[l.id] !== l.cantidadPresentacion)
  const motivoFalta = huboCambio && !motivo.trim()
  const confirmar = async () => {
    if (dejaTodoEnCero) { setError('Eso vacía la venta entera — usá "Anular" en la bandeja en vez de ajustar.'); return }
    setSubmitting(true)
    setError('')
    try {
      await ventaDirectaService.ajustar(
        venta.id,
        venta.lines.filter((l) => cantidades[l.id] !== l.cantidadPresentacion).map((l) => ({ lineaId: l.id, cantidadPresentacion: cantidades[l.id] })),
        venta.sesionCajaId,
        motivo.trim(),
      )
      notify(`${venta.numero} ajustada`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ajustar la venta')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Modal title={`Ajustar ${venta.numero}`} subtitle="Solo se puede reducir — para vender más, crear una venta nueva" onClose={onClose}>
      <div className="modal-body vtd-ajuste-lines">
        {venta.lines.map((line) => {
          const cantidad = cantidades[line.id]
          const rechazada = cantidad === 0
          const cambiada = !rechazada && cantidad !== line.cantidadPresentacion
          return (
            <div className="vtd-ajuste-line" key={line.id}>
              <span>{line.name}{line.presentacionNombre ? ` (${line.presentacionNombre})` : ''}{(rechazada || cambiada) && <span className="order-line-inactive-badge">{rechazada ? 'Rechazado' : 'Cambiado'}</span>}</span>
              <div className="qty-control">
                <button type="button" disabled={cantidad <= 0} onClick={() => setCantidades((c) => ({ ...c, [line.id]: Math.max(0, c[line.id] - 1) }))}><Minus size={11} /></button>
                <strong>{cantidad}</strong>
                <button type="button" disabled={cantidad >= line.cantidadPresentacion} onClick={() => setCantidades((c) => ({ ...c, [line.id]: Math.min(line.cantidadPresentacion, c[line.id] + 1) }))}>+</button>
              </div>
              <small>de {line.cantidadPresentacion}</small>
            </div>
          )
        })}
        <label>Motivo{huboCambio && !dejaTodoEnCero ? ' (obligatorio)' : ''}<textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Por qué se rechaza o cambia esta línea?" /></label>
        {error && <p className="mock-note payment-error">{error} {dejaTodoEnCero && <button type="button" className="vtd-retail-error-link" onClick={onClose}>Ir a anular</button>}</p>}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" disabled={submitting || !huboCambio || dejaTodoEnCero || motivoFalta} onClick={() => void confirmar()}>{submitting ? 'Guardando…' : 'Confirmar ajuste'}</button>
      </footer>
    </Modal>
  )
}
