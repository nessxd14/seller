import { Check, RotateCcw, Search, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PedidoVendedorCobroResultado, PedidoVendedorEnCola, PedidoVendedorRecord } from '../../application/shared/models'
import type { SaleCheckoutPayment } from '../../application/ports/repositories'
import { AmbiguousScanPicker } from '../../components/AmbiguousScanPicker'
import { Modal } from '../../components/Modal'
import { NumberField } from '../../components/NumberField'
import { VentaTicket } from '../../components/VentaTicket'
import { VtdPaymentModal } from '../../components/VtdPaymentModal'
import { createUuid } from '../../application/shared/createUuid'
import {
  bloqueos, cambiarPresentacionCaja, construirCobro, editarCantidad, editarPrecio, lineaAgregada, lineasDesdePedido, minutosEsperando, necesitaMotivo,
  quitarLinea, restaurarLinea, totalCents, totalLineaCents, totalVendedorCents, verificarLinea, verificarPorEscaneo, type LineaCaja,
} from '../../domain/sales/pedidoCaja'
import type { PresentacionPiso, ProductoPiso } from '../../domain/sales/pedidoPiso'
import { useQrHold } from '../../hooks/useQrHold'
import { auditEnd, auditStart } from '../../lib/auditoriaDvr'
import { authSessionProvider, listPresentations, pedidoVendedorService, productRepository } from '../../infrastructure/services'
import type { Product } from '../../types'
import type { PedidoEnCarrito } from '../../application/shared/cajaCheckout'

const bs = (cents: number) => (cents / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MOTIVOS_QUITAR = ['No lo lleva', 'Sin stock', 'Cambió por otro']
const MOTIVOS_DESCUENTO = ['Producto dañado', 'Cliente frecuente', 'Autorizó gerente']
const COLA_REFRESH_MS = 5000
const presentacionesCache = new Map<number, PresentacionPiso[]>()
const aProducto = (p: Product): ProductoPiso => ({ id: p.id, nombre: p.nombre, sku: p.sku, precioRetail: p.precioRetail })

type Paso = 'cola' | 'verificar' | 'pago' | 'retenido' | 'ticket'

/**
 * Cobro de un pedido de vendedor en caja: cola → verificación línea por línea → pago → resultado.
 * La verificación sincroniza sus líneas con el carrito cuando onCartChange está disponible.
 */
export function PedidoVendedorCobro({ sessionId, initialPedidoId, onClose, onChanged, notify, onCartChange, initialCart }: {
  sessionId: string
  initialPedidoId?: string | null
  onClose: () => void
  onChanged?: () => void
  notify: (message: string) => void
  onCartChange?: (pedido: PedidoEnCarrito | null) => void
  initialCart?: PedidoEnCarrito | null
}) {
  const [paso, setPaso] = useState<Paso>(initialCart ? 'verificar' : 'cola')
  const [cola, setCola] = useState<PedidoVendedorEnCola[] | null>(null)
  const [colaError, setColaError] = useState('')
  const [filtro, setFiltro] = useState('')
  const [tomando, setTomando] = useState<string | null>(null)
  const [pedido, setPedido] = useState<PedidoVendedorRecord | null>(initialCart?.pedido ?? null)
  const [lineas, setLineas] = useState<LineaCaja[]>(initialCart?.lineas ?? [])
  const [saliendo, setSaliendo] = useState<'menu' | 'anular' | null>(null)
  const [motivoAnular, setMotivoAnular] = useState('')
  const [accionError, setAccionError] = useState('')
  const [enAccion, setEnAccion] = useState(false)
  const [pagoError, setPagoError] = useState('')
  const [cobrando, setCobrando] = useState(false)
  const [resultado, setResultado] = useState<PedidoVendedorCobroResultado | null>(null)
  const cajeroId = useRef<string | undefined>(undefined)
  const inicioAutomatico = useRef(false)

  useEffect(() => {
    if (pedido && paso === 'verificar') onCartChange?.({ pedido, lineas })
  }, [pedido, lineas, paso, onCartChange])

  const hold = useQrHold({ saleId: resultado?.ventaId ?? null, onVerified: () => irATicket() })

  useEffect(() => {
    void authSessionProvider.getSession().then((s) => { cajeroId.current = s?.user.email ?? undefined }).catch(() => undefined)
  }, [])

  // ── 1. Cola ───────────────────────────────────────────────────────────────────────
  const cargarCola = useCallback(() => pedidoVendedorService.cola()
    .then((lista) => { setCola(lista); setColaError('') })
    .catch((error) => { setColaError(error instanceof Error ? error.message : 'No se pudo consultar la cola') }), [])
  useEffect(() => {
    if (paso !== 'cola') return
    void cargarCola()
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void cargarCola() }, COLA_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [paso, cargarCola])

  const tomar = useCallback(async (pedidoId: string) => {
    setTomando(pedidoId)
    setColaError('')
    try {
      const tomado = await pedidoVendedorService.tomar(pedidoId, sessionId)
      setPedido(tomado)
      setLineas(lineasDesdePedido(tomado))
      auditStart({ transactionId: `pdv-${pedidoId}`, cajeroId: cajeroId.current })
      setPaso('verificar')
      onChanged?.()
    } catch (error) {
      setColaError(error instanceof Error ? error.message : 'No se pudo tomar el pedido')
    } finally {
      setTomando(null)
    }
  }, [sessionId, onChanged])

  // Abierto desde el QR del vendedor: toma el pedido directamente (la guarda evita el doble efecto de StrictMode).
  useEffect(() => {
    if (!initialPedidoId || initialCart || inicioAutomatico.current) return
    inicioAutomatico.current = true
    void tomar(initialPedidoId)
  }, [initialPedidoId, tomar, initialCart])

  // ── 2. Verificación ───────────────────────────────────────────────────────────────
  const cambiar = (key: string, fn: (l: LineaCaja) => LineaCaja) => setLineas((prev) => prev.map((l) => (l.key === key ? fn(l) : l)))
  const total = totalCents(lineas)
  const razones = bloqueos(lineas)
  const vivas = lineas.filter((l) => !l.quitada)
  const verificadas = vivas.filter((l) => l.verificada).length

  const cerrarFlujo = (razon: 'cancelada' | null) => {
    if (razon) onCartChange?.(null)
    if (razon && pedido) auditEnd({ transactionId: `pdv-${pedido.pedidoId}`, reason: razon })
    onChanged?.()
    onClose()
  }
  const devolverACola = async () => {
    if (!pedido) return
    setEnAccion(true); setAccionError('')
    try { await pedidoVendedorService.devolver(pedido.pedidoId); cerrarFlujo('cancelada') }
    catch (error) { setAccionError(error instanceof Error ? error.message : 'No se pudo devolver el pedido a la cola') }
    finally { setEnAccion(false) }
  }
  const anularPedido = async () => {
    if (!pedido) return
    setEnAccion(true); setAccionError('')
    try { await pedidoVendedorService.anular(pedido.pedidoId, motivoAnular.trim()); cerrarFlujo('cancelada') }
    catch (error) { setAccionError(error instanceof Error ? error.message : 'No se pudo anular el pedido') }
    finally { setEnAccion(false) }
  }
  const pedirSalir = () => { if (onCartChange && !razones.length) { onClose(); return }; setAccionError(''); setSaliendo('menu') }

  // ── 3. Pago y 4. Resultado ───────────────────────────────────────────────────────
  const irATicket = () => setPaso('ticket')
  const confirmarPago = async (pagos: SaleCheckoutPayment[]) => {
    if (!pedido || cobrando) return
    setCobrando(true); setPagoError('')
    try {
      const cobro = construirCobro(lineas)
      const r = await pedidoVendedorService.cobrar({ pedidoId: pedido.pedidoId, lineas: cobro.lineas, quitadas: cobro.quitadas, pagos, sesionCajaId: sessionId })
      setResultado(r)
      auditEnd({ transactionId: `pdv-${pedido.pedidoId}`, reason: 'completada', numero: r.numero ?? undefined, totalBs: r.total })
      onChanged?.()
      notify(r.reintento ? 'Este cobro ya estaba registrado. No se cobró dos veces.' : `Pedido ${pedido.numeroDia} cobrado${r.numero ? ` — ${r.numero}` : ''}`)
      const qrCents = pagos.filter((p) => p.method === 'qr').reduce((sum, p) => sum + p.amountCents, 0)
      // Con QR y el banco en línea la venta queda retenida hasta VERIFICADO; con el banco fuera de línea nunca se frena al cajero.
      if (qrCents > 0) {
        if (await hold.iniciar(qrCents)) { setPaso('retenido'); return }
        notify('Banco sin conexión: el QR queda pendiente y lo verifica el gerente.')
      }
      setPaso('ticket')
    } catch (error) {
      // Una respuesta perdida puede ser una venta confirmada: el mismo intento se puede repetir (misma clave de idempotencia).
      setPagoError(error instanceof Error ? error.message : 'No se pudo cobrar el pedido')
    } finally {
      setCobrando(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────────
  if (paso === 'ticket' && resultado) {
    return <VentaTicket id={resultado.ventaId} onClose={onClose} />
  }

  if (paso === 'retenido') {
    return <Modal title="Esperando confirmación del QR…" subtitle={resultado?.numero ? `Ticket ${resultado.numero}` : undefined} onClose={onClose}>
      <div className="success-state qr-hold-state">
        <p>Monto QR: Bs {bs(hold.qrAmountCents)}</p>
        <p className="qr-hold-elapsed">{hold.elapsedS}s</p>
        {hold.phase === 'vencida' && <>
          <p className="mock-note">No se recibió confirmación del banco todavía.</p>
          <p className="qr-hold-warning">No entregues la mercadería hasta que el gerente confirme el pago.</p>
        </>}
      </div>
      <footer className="modal-actions">
        {hold.phase === 'vencida'
          ? <><button className="secondary-button" onClick={hold.seguirEsperando}>Seguir esperando</button><button className="primary-button full-button" onClick={onClose}>Dejar retenida</button></>
          : <button className="secondary-button full-button" onClick={onClose}>Dejar retenida</button>}
      </footer>
    </Modal>
  }

  if (paso === 'pago' && pedido) {
    return <VtdPaymentModal title={`Cobrar pedido ${pedido.numeroDia}`} subtitle={`${pedido.vendedor} · ${vivas.length} línea${vivas.length === 1 ? '' : 's'}`} total={total / 100} submitting={cobrando} error={pagoError} onClose={() => { if (!cobrando) { setPagoError(''); setPaso('verificar') } }} onConfirm={(pagos) => void confirmarPago(pagos)} />
  }

  if (paso === 'verificar' && pedido) {
    const minutos = minutosEsperando(pedido.enviadoEn)
    const totalVendedor = totalVendedorCents(lineas)
    return <Modal wide className="pedido-vendedor-modal" title={`Pedido ${pedido.numeroDia} · ${pedido.vendedor}${minutos != null ? ` · hace ${minutos} min` : ''}`} subtitle={pedido.nota ? `Nota del vendedor: ${pedido.nota}` : 'Verifica cada línea antes de cobrar'} onClose={pedirSalir} escapeToClose={saliendo === null}>
      <div className="modal-body pv-cuerpo">
        <div className="pv-progress"><div><span>REVISIÓN EN CAJA</span><strong>{verificadas} de {vivas.length} productos verificados</strong></div><progress max={Math.max(1, vivas.length)} value={verificadas} /><p>{onCartChange ? 'Los productos verificados aparecen en el carrito. Revisa cantidades y precios antes del cobro.' : 'Revisa cada producto antes de cobrar.'}</p></div>
        <BuscadorCaja
          onVerificar={(producto, presentacionId) => {
            const r = verificarPorEscaneo(lineas, producto.id, presentacionId)
            if (r.resultado === 'verificada') { setLineas(r.lineas); notify(`Verificado: ${producto.nombre}`) }
            else if (r.resultado === 'ya_verificada') notify('Ya verificado')
            return r.resultado
          }}
          onAgregar={(producto) => { setLineas((prev) => [...prev, lineaAgregada(aProducto(producto), createUuid())]); notify(`Agregado en caja: ${producto.nombre}`) }}
          notify={notify}
        />
        <div className="pv-lineas">
          {lineas.map((l) => <FilaCaja key={l.key} linea={l}
            onVerificar={() => cambiar(l.key, (x) => verificarLinea(x, !x.verificada))}
            onCantidad={(c) => cambiar(l.key, (x) => editarCantidad(x, c))}
            onPrecio={(cents) => cambiar(l.key, (x) => editarPrecio(x, cents))}
            onPresentacion={(p) => cambiar(l.key, (x) => cambiarPresentacionCaja(x, p))}
            onQuitar={(motivo) => cambiar(l.key, (x) => quitarLinea(x, motivo))}
            onRestaurar={() => cambiar(l.key, restaurarLinea)}
            onEliminar={() => setLineas((prev) => prev.filter((x) => x.key !== l.key))}
            onMotivoDescuento={(m) => cambiar(l.key, (x) => ({ ...x, motivoDescuento: m }))} />)}
        </div>
      </div>
      <footer className="modal-actions pv-pie">
        <div className="pv-resumen"><strong>{verificadas} de {vivas.length} verificadas</strong>{totalVendedor !== total && <small>Vendedor Bs {bs(totalVendedor)} → ahora Bs {bs(total)}</small>}</div>
        {onCartChange && <button type="button" className="secondary-button" onClick={() => setSaliendo('menu')}>Opciones del pedido</button>}
        <button type="button" className="primary-button pv-cobrar" disabled={razones.length > 0} title={razones[0]} onClick={() => { if (onCartChange) { onCartChange({ pedido, lineas }); onClose() } else { setPagoError(''); setPaso('pago') } }}>{onCartChange ? 'Continuar en carrito' : `Cobrar Bs ${bs(total)}`}</button>
      </footer>
      {saliendo && <div className="pv-salir" role="dialog" aria-label="Salir del pedido">
        {saliendo === 'menu'
          ? <>
            <h3>¿Qué hacemos con el pedido {pedido.numeroDia}?</h3>
            <button type="button" className="primary-button" disabled={enAccion} onClick={() => void devolverACola()}>Devolver a la cola</button>
            <button type="button" className="secondary-button" disabled={enAccion} onClick={() => { setAccionError(''); setSaliendo('anular') }}>Anular pedido</button>
            <button type="button" className="secondary-button" disabled={enAccion} onClick={() => setSaliendo(null)}>Seguir cobrando</button>
          </>
          : <>
            <h3>Anular pedido {pedido.numeroDia}</h3>
            <label>Motivo (obligatorio)<input autoFocus type="text" maxLength={200} value={motivoAnular} onChange={(e) => setMotivoAnular(e.target.value)} placeholder="Por qué se anula" /></label>
            <button type="button" className="primary-button peligro" disabled={enAccion || motivoAnular.trim().length < 3} onClick={() => void anularPedido()}>Anular pedido</button>
            <button type="button" className="secondary-button" disabled={enAccion} onClick={() => setSaliendo('menu')}>Volver</button>
          </>}
        {accionError && <p role="alert" className="mock-note payment-error">{accionError}</p>}
      </div>}
    </Modal>
  }

  // paso === 'cola' (o 'verificar' aún sin pedido: tomando desde el QR)
  const q = filtro.trim().toLowerCase()
  const visibles = (cola ?? []).filter((p) => !q || String(p.numeroDia).includes(q) || p.vendedor.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q))
  return <Modal wide className="pedido-vendedor-modal" title="Pedidos de vendedor" subtitle="Toma un pedido para verificarlo y cobrarlo" onClose={onClose}>
    <div className="modal-body pv-cuerpo">
      <label className="pv-filtro"><Search aria-hidden="true" /><input type="search" placeholder="Filtrar por número o vendedor" aria-label="Filtrar pedidos" value={filtro} onChange={(e) => setFiltro(e.target.value)} /></label>
      {colaError && <p role="alert" className="mock-note payment-error">{colaError}</p>}
      {cola === null && !colaError && <p className="pv-vacio" role="status">Cargando…</p>}
      {cola !== null && !visibles.length && <p className="pv-vacio">{cola.length ? 'Ningún pedido coincide' : 'No hay pedidos esperando'}</p>}
      <ul className="pv-cola">
        {visibles.map((p) => {
          const propio = p.estado === 'EN_CAJA' && p.sesionCajaId === sessionId
          const ajeno = p.estado === 'EN_CAJA' && !propio
          const minutos = minutosEsperando(p.enviadoEn)
          return <li key={p.pedidoId}><button type="button" disabled={ajeno || tomando !== null} onClick={() => void tomar(p.pedidoId)}>
            <b className="pv-numero">{p.numeroDia}</b>
            <span className="pv-quien"><strong>{p.vendedor}</strong><small>{minutos != null ? `hace ${minutos} min · ` : ''}{p.lineas} línea{p.lineas === 1 ? '' : 's'}</small></span>
            <span className="pv-estado">{propio ? 'En tu caja' : ajeno ? `En caja con ${p.tomadoPor ?? 'otro cajero'}` : tomando === p.pedidoId ? 'Tomando…' : ''}</span>
            <b className="pv-total">Bs {(p.total).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
          </button></li>
        })}
      </ul>
    </div>
  </Modal>
}

/** Campo de escaneo y búsqueda: conserva el foco para que el lector siga disparando. */
function BuscadorCaja({ onVerificar, onAgregar, notify }: {
  onVerificar: (product: Product, presentacionId?: number | null) => 'verificada' | 'ya_verificada' | 'no_esta'
  onAgregar: (product: Product) => void
  notify: (message: string) => void
}) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Product[]>([])
  const [ambiguos, setAmbiguos] = useState<number[] | null>(null)
  const [faltante, setFaltante] = useState<Product | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const refocus = () => requestAnimationFrame(() => input.current?.focus())

  useEffect(() => {
    const q = texto.trim()
    if (q.length < 2) return
    let cancelado = false
    const id = window.setTimeout(() => {
      productRepository.search({ query: q, active: true, page: { page: 1, pageSize: 12 } }).then((p) => { if (!cancelado) setResultados(p.items) }).catch(() => { if (!cancelado) setResultados([]) })
    }, 250)
    return () => { cancelado = true; window.clearTimeout(id) }
  }, [texto])

  const procesar = (producto: Product, presentacionId?: number | null) => {
    const r = onVerificar(producto, presentacionId)
    setFaltante(r === 'no_esta' ? producto : null)
    if (r === 'no_esta') notify('No está en el pedido')
  }
  const alEnter = async () => {
    const codigo = texto.trim()
    if (!codigo) return
    setTexto(''); setResultados([])
    try {
      const r = await productRepository.resolveScannedCode(codigo)
      if (r.kind === 'found') procesar(r.product, r.presentation ? (r.presentation.esBase || r.presentation.factorUnidadBase === 1 ? null : r.presentation.id) : undefined)
      else if (r.kind === 'ambiguous') setAmbiguos(r.productIds)
      else notify('Código no reconocido')
    } catch (e) { notify(e instanceof Error ? e.message : 'No se pudo leer el código') }
    refocus()
  }

  return <div className="pv-buscador">
    <label><Search aria-hidden="true" /><input ref={input} autoFocus type="text" autoComplete="off" aria-label="Escanear o buscar producto" placeholder="Escanea un código o busca un producto para agregar" value={texto}
      onChange={(e) => { setTexto(e.target.value); if (e.target.value.trim().length < 2) setResultados([]) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void alEnter() } }} /></label>
    {faltante && <p className="pv-faltante" role="status">«{faltante.nombre}» no está en el pedido. <button type="button" onClick={() => { onAgregar(faltante); setFaltante(null); refocus() }}>Agregar</button></p>}
    {texto.trim().length >= 2 && resultados.length > 0 && <ul className="pv-resultados">
      {resultados.map((p) => <li key={p.id}><button type="button" onClick={() => { onAgregar(p); setTexto(''); setResultados([]); refocus() }}><strong>{p.nombre}</strong><small>{p.sku}</small><b>{p.precioRetail > 0 ? `Bs ${p.precioRetail.toLocaleString('es-BO', { minimumFractionDigits: 2 })}` : 'Sin precio'}</b></button></li>)}
    </ul>}
    {ambiguos && <AmbiguousScanPicker productIds={ambiguos} onPick={(p) => { setAmbiguos(null); procesar(p); refocus() }} onClose={() => { setAmbiguos(null); refocus() }} />}
  </div>
}

function FilaCaja({ linea, onVerificar, onCantidad, onPrecio, onPresentacion, onQuitar, onRestaurar, onEliminar, onMotivoDescuento }: {
  linea: LineaCaja
  onVerificar: () => void
  onCantidad: (c: number) => void
  onPrecio: (cents: number) => void
  onPresentacion: (p: PresentacionPiso) => void
  onQuitar: (motivo?: string) => void
  onRestaurar: () => void
  onEliminar: () => void
  onMotivoDescuento: (m: string) => void
}) {
  const [presentaciones, setPresentaciones] = useState<PresentacionPiso[] | null>(null)
  const [mostrarPres, setMostrarPres] = useState(false)
  const [quitando, setQuitando] = useState(false)
  const [otro, setOtro] = useState(false)
  const motivoNecesario = necesitaMotivo(linea)

  const abrirPresentaciones = () => {
    setMostrarPres((v) => !v)
    if (linea.productoId == null || presentaciones) return
    const hit = presentacionesCache.get(linea.productoId)
    if (hit) { setPresentaciones(hit); return }
    void listPresentations(linea.productoId).then((l) => { presentacionesCache.set(linea.productoId as number, l); setPresentaciones(l) }).catch(() => setPresentaciones([]))
  }

  const dif = linea.precioVendedorCents != null && linea.precioListaCents != null && linea.precioVendedorCents !== linea.precioListaCents && linea.precioListaCents > 0
    ? `Lista ${bs(linea.precioListaCents)} → ${bs(linea.precioVendedorCents)}, ${linea.precioVendedorCents < linea.precioListaCents ? '−' : '+'}${Math.abs(Math.round(((linea.precioListaCents - linea.precioVendedorCents) / linea.precioListaCents) * 100))} %`
    : null

  if (linea.quitada) {
    return <article className="pv-linea quitada">
      <div className="pv-linea-nombre"><s>{linea.nombre}</s><small>{linea.motivoQuitada ?? 'Quitada del pedido'}</small></div>
      <button type="button" className="secondary-button" onClick={onRestaurar}><Undo2 /> Deshacer</button>
    </article>
  }

  return <article className={`pv-linea ${linea.verificada ? 'verificada' : ''}`}>
    <div className="pv-linea-nombre">
      <strong>{linea.nombre}</strong>
      <small>{linea.esPersonalizado ? `Fuera de catálogo · ${linea.unidadMedida ?? 'UNIDAD'}` : linea.presentacionNombre ?? 'Unidad'}{linea.agregada && <span className="pv-etiqueta">Agregado en caja</span>}</small>
      {dif && <small className="pv-dif">{dif}</small>}
      {linea.cantidadVendedor != null && linea.cantidadVendedor !== linea.cantidad && <small className="pv-dif">Vendedor: {linea.cantidadVendedor}</small>}
    </div>
    <label className="pv-campo">Cantidad<NumberField ariaLabel={`Cantidad de ${linea.nombre}`} min={0} step={1} value={linea.cantidad} onCommit={(v) => { if (v > 0 && v !== linea.cantidad) onCantidad(v) }} /></label>
    <label className="pv-campo">Precio (Bs)<NumberField ariaLabel={`Precio de ${linea.nombre}`} min={0} step={0.01} value={linea.precioCents / 100} onCommit={(v) => { const cents = Math.round(v * 100); if (cents !== linea.precioCents) onPrecio(cents) }} /></label>
    <b className="pv-subtotal">Bs {bs(totalLineaCents(linea))}</b>
    <div className="pv-acciones">
      <button type="button" className={`pv-verificar ${linea.verificada ? 'activo' : ''}`} aria-pressed={linea.verificada} aria-label={`${linea.verificada ? 'Verificada' : 'Verificar'}: ${linea.nombre}`} onClick={onVerificar}><Check /> {linea.verificada ? 'Verificada' : 'Verificar'}</button>
      {!linea.esPersonalizado && <button type="button" className="secondary-button" onClick={abrirPresentaciones}><RotateCcw /> Presentación</button>}
      {linea.agregada
        ? <button type="button" className="secondary-button peligro" aria-label={`Quitar ${linea.nombre}`} onClick={onEliminar}><Trash2 /> Quitar</button>
        : <button type="button" className="secondary-button peligro" aria-label={`No lo lleva: ${linea.nombre}`} onClick={() => setQuitando((v) => !v)}><Trash2 /> No lo lleva</button>}
    </div>
    {mostrarPres && <div className="pv-chips" role="group" aria-label="Presentación">
      {presentaciones === null && <small>Cargando…</small>}
      {presentaciones?.map((p) => {
        const activa = p.esBase || p.factorUnidadBase === 1 ? linea.presentacionId == null : linea.presentacionId === p.id
        return <button key={p.id} type="button" className={activa ? 'activo' : ''} aria-pressed={activa} onClick={() => { onPresentacion(p); setMostrarPres(false) }}>{p.nombre}{!p.esBase && p.factorUnidadBase !== 1 ? ` (${p.factorUnidadBase})` : ''}</button>
      })}
    </div>}
    {quitando && <div className="pv-chips" role="group" aria-label="Motivo para quitar">
      {MOTIVOS_QUITAR.map((m) => <button key={m} type="button" onClick={() => { onQuitar(m); setQuitando(false) }}>{m}</button>)}
      <button type="button" onClick={() => { onQuitar(); setQuitando(false) }}>Sin motivo</button>
    </div>}
    {motivoNecesario && <div className="pv-motivo" role="group" aria-label="Motivo del descuento">
      <span className="pv-motivo-req">Motivo del descuento (obligatorio)</span>
      <div className="pv-chips">
        {MOTIVOS_DESCUENTO.map((m) => <button key={m} type="button" className={!otro && linea.motivoDescuento === m ? 'activo' : ''} aria-pressed={!otro && linea.motivoDescuento === m} onClick={() => { setOtro(false); onMotivoDescuento(m) }}>{m}</button>)}
        <button type="button" className={otro ? 'activo' : ''} aria-pressed={otro} onClick={() => { setOtro(true); if (MOTIVOS_DESCUENTO.includes(linea.motivoDescuento ?? '')) onMotivoDescuento('') }}>Otro</button>
      </div>
      {otro && <input type="text" aria-label="Otro motivo" maxLength={120} placeholder="Escribe el motivo" value={linea.motivoDescuento ?? ''} onChange={(e) => onMotivoDescuento(e.target.value)} />}
    </div>}
  </article>
}

