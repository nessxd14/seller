import { Flashlight, FlashlightOff, ListOrdered, PackageX, Plus, ScanLine, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import type { PedidoCanal, PedidoVendedorEstado } from '../../application/shared/models'
import { AmbiguousScanPicker } from '../../components/AmbiguousScanPicker'
import { DocQr } from '../../components/DocQr'
import { Modal } from '../../components/Modal'
import { UnitOfMeasureField } from '../../components/UnitOfMeasureField'
import { hoyLocal } from '../../domain/common/fechas'
import { desactivarModoTienda, veBandaModoTienda } from '../../domain/piso/modoTienda'
import { navigate } from '../../router/history'
import { parteCobrada } from '../../domain/sales/cuentaVendedor'
import { bajoElMinimo, motivoNoEnviar, round2, sePuedeMoverAAlmacen, totalPedido, type LineaPiso, type PedidoLocal, type PresentacionPiso, type ProductoPiso } from '../../domain/sales/pedidoPiso'
import { presentacionAlAgregar } from '../../lib/presentacionAlAgregar'
import { opcionesDelLado } from '../../domain/pricing/presentacionesPorLado'
import { getStockBySucursalBatch, listPresentations, pedidoVendedorService, productRepository } from '../../infrastructure/services'
import type { Product } from '../../types'
import { EscanerContinuo, useWakeLock, vibrarDesconocido } from './EscanerContinuo'
import { usePedidosPiso } from './usePedidosPiso'
import { TrasladosPiso } from './TrasladosPiso'
import { BotonSalir, SalirPiso } from './SalirPiso'
import { MisVentasPiso } from './MisVentasPiso'
import { HojaNoRealizada } from './HojaNoRealizada'
import { InicioPiso } from './InicioPiso'
import { FotoProductoPiso } from './FotoProductoPiso'

const bs = (v: number) => v.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
interface StockLinea { tienda: number; almacen: number }
const fmtQty = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 })
const horaCorta = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const aProducto = (p: Product): ProductoPiso => ({ id: p.id, nombre: p.nombre, sku: p.sku, precioRetail: p.precioRetail })
const ETIQUETA_ESTADO: Record<PedidoVendedorEstado, string> = { ARMANDO: 'Armando', ENVIADO: 'En espera de caja', EN_CAJA: 'En caja', COBRADO: 'Cobrado', ANULADO: 'Anulado' }

// Presentaciones por producto: se piden la primera vez que se abre la hoja y se reutilizan.
const cachePresentaciones = new Map<number, PresentacionPiso[]>()

type Vista = 'inicio' | 'vender' | 'traslados' | 'ventas'

type Hoja =
  | { tipo: 'cantidad'; localId: string }
  | { tipo: 'precio'; localId: string }
  | { tipo: 'personalizado' }
  | { tipo: 'pedidos' }
  | { tipo: 'noRealizada'; texto?: string; productoId?: number; productoNombre?: string }
  | null

export function PedidoPisoApp({ session, modoTienda = false }: { session: AuthSession; modoTienda?: boolean }) {
  useWakeLock()
  const piso = usePedidosPiso(session.user.id)
  const { activo } = piso
  // Vendedor, reponedor y cajero no pueden bajar del mínimo (lista − 10 %); gerente y admin sí.
  // «Modo tienda»: cualquier rol con piso atiende como reponedor (lo vendido queda a su nombre). El vendedor conserva su texto de siempre.
  const esReponedor = session.user.role === 'reponedor' || (modoTienda && session.user.role !== 'vendedor')
  const conNavegacion = session.user.role === 'vendedor' || esReponedor
  const conPiso = conNavegacion || session.user.role === 'cajero'
  // El reponedor habla de "venta"; el resto de "pedido".
  const palabra = esReponedor ? 'Venta' : 'Pedido'
  const [hoja, setHoja] = useState<Hoja>(null)
  const [plegado, setPlegado] = useState(false)
  const [linterna, setLinterna] = useState(false)
  const [linternaSoportada, setLinternaSoportada] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ambiguos, setAmbiguos] = useState<number[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [vista, setVista] = useState<Vista>(conNavegacion ? 'inicio' : 'vender')
  // Sube al guardar una venta no realizada: Inicio relee los contadores del turno.
  const [versionTurno, setVersionTurno] = useState(0)
  const [saliendo, setSaliendo] = useState(false)
  // Inicio abre «Pedir traslado» directo en la pantalla de pedir.
  const [pedirDirecto, setPedirDirecto] = useState(false)
  const [agregadoCaja, setAgregadoCaja] = useState<number | null>(null)
  // Stock por producto de las líneas del pedido activo: sirve para mostrarlo y para ofrecer «Mover» a almacén.
  const [stock, setStock] = useState<Record<number, StockLinea>>({})
  const avisoTimer = useRef<number | undefined>(undefined)

  const avisar = useCallback((mensaje: string) => {
    setAviso(mensaje)
    window.clearTimeout(avisoTimer.current)
    avisoTimer.current = window.setTimeout(() => setAviso(''), 2600)
  }, [])
  useEffect(() => () => window.clearTimeout(avisoTimer.current), [])

  const { agregar } = piso
  // Celular del piso = tienda: solo productos y presentaciones habilitados para vender en tienda.
  const agregarSiSeVende = useCallback(async (producto: Product, escaneada?: PresentacionPiso) => {
    const permiso = await presentacionAlAgregar(producto.id, 'tienda', escaneada)
    if (!permiso.ok) { avisar(permiso.mensaje); return }
    agregar(aProducto(producto), escaneada ?? (permiso.inicial && !permiso.inicial.esBase && permiso.inicial.factorUnidadBase !== 1 ? permiso.inicial : undefined))
    avisar(`Agregado: ${producto.nombre}`)
  }, [agregar, avisar])
  const alEscanear = useCallback(async (codigo: string) => {
    try {
      const r = await productRepository.resolveScannedCode(codigo)
      if (r.kind === 'found') await agregarSiSeVende(r.product, r.presentation)
      else if (r.kind === 'ambiguous') setAmbiguos(r.productIds)
      else { vibrarDesconocido(); avisar('Código no reconocido') }
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo leer el código') }
  }, [agregarSiSeVende, avisar])

  const editable = activo.estado === 'ARMANDO'
  const lineaDe = (localId: string) => activo.lineas.find((l) => l.localId === localId)
  const { total, sinPrecio } = totalPedido(activo.lineas)
  const esAlmacen = activo.canal === 'ALMACEN'
  const clavesStock = [...new Set(activo.lineas.flatMap((l) => (!l.esPersonalizado && l.productoId != null ? [l.productoId] : [])))].sort((a, b) => a - b).join(',')
  useEffect(() => {
    if (!clavesStock) return
    let cancelado = false
    const ids = clavesStock.split(',').map(Number)
    // Mejor esfuerzo: sin stock simplemente no se muestra ni se ofrece «Mover».
    void Promise.resolve().then(() => getStockBySucursalBatch(ids)).then((lote) => {
      if (cancelado) return
      setStock((prev) => {
        const siguiente = { ...prev }
        for (const id of ids) { const e = lote.get(id); if (e) siguiente[id] = { tienda: e.tiendaVendible, almacen: e.almacenVendible } }
        return siguiente
      })
    }).catch(() => {})
    return () => { cancelado = true }
  }, [clavesStock])
  const cambiarCanal = (canal: PedidoCanal) => { if (!piso.setCanal(canal)) avisar('Quita los productos fuera de catálogo: la venta de almacén no los admite.') }
  const moverAAlmacen = (localId: string) => { if (piso.mover(localId)) avisar('Pasó a una venta de almacén guardada. En caja se pueden cobrar las dos juntas.') }
  const titulo = activo.numeroDia != null ? `${palabra} ${activo.numeroDia}` : esReponedor ? 'Venta nueva' : 'Pedido nuevo'

  // Lo que caja sumó encima de lo que anotó el vendedor: solo lo sabe mi_cuenta_vendedor (mejor esfuerzo; si falla, no se muestra).
  const cobradoId = activo.estado === 'COBRADO' ? activo.pedidoId : null
  useEffect(() => {
    if (!cobradoId) return
    let cancelado = false
    const hoy = hoyLocal()
    pedidoVendedorService.misCuentaVendedor(hoy, hoy)
      .then((c) => { if (!cancelado) setAgregadoCaja(c.pedidos.find((x) => x.pedidoId === cobradoId)?.agregadoCaja ?? null) })
      .catch(() => { if (!cancelado) setAgregadoCaja(null) })
    return () => { cancelado = true; setAgregadoCaja(null) }
  }, [cobradoId])

  const enviar = async () => { setEnviando(true); try { await piso.enviar() } finally { setEnviando(false) } }

  const textoArmar = `Armar ${esReponedor ? 'venta' : 'pedido'}`
  const banda = modoTienda && veBandaModoTienda(session.user.role)
    ? <div className="piso-banda-modo"><span>Modo tienda · {session.user.name} ({session.user.role})</span><button type="button" onClick={() => { desactivarModoTienda(session.user.id); navigate('/') }}>‹ Volver al Seller</button></div>
    : null
  const nav = conNavegacion ? <NavegacionPiso vista={vista} textoArmar={textoArmar} onElegir={(v) => { setPedirDirecto(false); setVista(v) }} /> : null
  const hojaNoRealizada = hoja?.tipo === 'noRealizada'
    ? <HojaNoRealizada textoInicial={hoja.texto} productoInicial={hoja.productoId != null ? { id: hoja.productoId, nombre: hoja.productoNombre ?? '' } : undefined} onClose={() => setHoja(null)} onGuardado={(veces) => { setHoja(null); setVersionTurno((v) => v + 1); avisar(veces > 0 ? `Guardado. Van ${veces} pedidos de esto esta semana.` : 'Guardado.') }} />
    : null
  const salirHoja = saliendo ? <SalirPiso nombre={session.user.name} palabra={palabra} guardados={piso.pedidos.filter((p) => p.estado === 'ARMANDO' && p.lineas.length > 0)} onClose={() => setSaliendo(false)} /> : null
  const abribles = new Set(piso.pedidos.flatMap((p) => (p.pedidoId ? [p.pedidoId] : [])))
  const abrirVenta = (pedidoId: string) => {
    const local = piso.pedidos.find((p) => p.pedidoId === pedidoId)
    if (local) { piso.activar(local.clave); setVista('vender') }
  }

  if (vista === 'inicio') return <div className="piso-app con-nav">{banda}<InicioPiso session={session} textoArmar={textoArmar} version={versionTurno} onArmar={() => setVista('vender')} onTraslado={() => { setPedirDirecto(true); setVista('traslados') }} onSalir={() => setSaliendo(true)} onNoRealizada={() => setHoja({ tipo: 'noRealizada' })} />{aviso && <p role="status" className="piso-toast">{aviso}</p>}{hojaNoRealizada}{salirHoja}{nav}</div>
  if (vista === 'traslados') return <div className={`piso-app${conNavegacion ? ' con-nav' : ''}`}>{banda}<TrasladosPiso key={pedirDirecto ? 'pedir' : 'lista'} session={session} aviso={avisar} iniciarPedido={pedirDirecto} onVolver={conNavegacion ? undefined : () => setVista('vender')} />{aviso && <p role="status" className="piso-toast">{aviso}</p>}{nav}</div>
  if (vista === 'ventas') return <div className="piso-app con-nav">{banda}<header className="piso-header"><div><h1>Mis ventas</h1></div></header><MisVentasPiso abribles={abribles} onAbrir={abrirVenta} />{nav}</div>
  return <div className={`piso-app${conNavegacion ? ' con-nav' : ''}${esAlmacen ? ' modo-almacen' : ''}`}>
    {banda}
    <header className="piso-header">
      <div><h1>{titulo}</h1><small>{activo.lineas.length} {activo.lineas.length === 1 ? 'línea' : 'líneas'} · {ETIQUETA_ESTADO[activo.estado]}{esAlmacen ? ' · De almacén' : ''}</small></div>
      {linternaSoportada && editable && !plegado && <button type="button" className="piso-icono" aria-pressed={linterna} aria-label={linterna ? 'Apagar linterna' : 'Encender linterna'} onClick={() => setLinterna((v) => !v)}>{linterna ? <FlashlightOff /> : <Flashlight />}</button>}
      {!conNavegacion && <button type="button" className="piso-icono con-texto" onClick={() => setHoja({ tipo: 'noRealizada' })}><PackageX /> <span>Venta no realizada</span></button>}
      <button type="button" className="piso-icono con-texto" onClick={() => setHoja({ tipo: 'pedidos' })}><ListOrdered /> <span>Mis pedidos</span>{piso.abiertos > 1 && <b>{piso.abiertos}</b>}</button>
      {!conNavegacion && <button type="button" className="piso-icono con-texto" onClick={() => { setPedirDirecto(false); setVista('traslados') }}>Traslados</button>}
      {!conNavegacion && <BotonSalir onClick={() => setSaliendo(true)} />}
    </header>

    {editable && conNavegacion && <div className="piso-canal" role="group" aria-label="Canal de la venta">
      <button type="button" aria-pressed={!esAlmacen} className={!esAlmacen ? 'activo' : ''} onClick={() => cambiarCanal('TIENDA')}>De tienda</button>
      <button type="button" aria-pressed={esAlmacen} className={esAlmacen ? 'activo' : ''} onClick={() => cambiarCanal('ALMACEN')}>De almacén (VTD)</button>
    </div>}
    {piso.sinConexion && <p className="piso-banner" role="status">Sin conexión. Guardado en este teléfono</p>}
    {aviso && <p className="piso-toast" role="status">{aviso}</p>}

    {editable && esAlmacen && <section className="piso-almacen-info" aria-label="Venta de almacén">
      <p>Sale del almacén: caja cobra al cliente y almacén se lo entrega con el ticket.</p>
      <label className="piso-campo">Cliente (para que almacén lo reconozca)<input className="piso-input" type="text" value={activo.nota ?? ''} maxLength={120} placeholder="Obligatorio para enviar a caja" onChange={(e) => piso.setNota(e.target.value)} /></label>
    </section>}
    {editable
      ? <>
        <section className="piso-captura" aria-label="Agregar productos">
          <button type="button" className="piso-plegar" aria-expanded={!plegado} onClick={() => setPlegado((v) => !v)}><ScanLine /> {plegado ? 'Abrir cámara' : 'Ocultar cámara'}</button>
          <EscanerContinuo onCodigo={(c) => void alEscanear(c)} plegado={plegado} linterna={linterna} onSoporteLinterna={setLinternaSoportada} />
          <Buscador onElegir={(p) => { void agregarSiSeVende(p) }} onAnotar={(texto, p) => setHoja({ tipo: 'noRealizada', texto, productoId: p?.id, productoNombre: p?.nombre })} />
        </section>
        <section className="piso-lineas" aria-label={`Productos de la ${palabra.toLowerCase()}`}>
          {!activo.lineas.length && <p className="piso-vacio">Escanea un código o busca un producto para empezar.</p>}
          {[...activo.lineas].reverse().map((l) => <FilaLinea key={l.localId} linea={l} stock={l.productoId != null ? stock[l.productoId] : undefined} esAlmacen={esAlmacen} onMover={() => moverAAlmacen(l.localId)} onCantidad={() => setHoja({ tipo: 'cantidad', localId: l.localId })} onPrecio={() => setHoja({ tipo: 'precio', localId: l.localId })} onQuitar={() => piso.quitar(l.localId)} />)}
          {!esAlmacen && <button type="button" className="piso-fuera-catalogo" onClick={() => setHoja({ tipo: 'personalizado' })}><Plus /> Producto fuera de catálogo</button>}
        </section>
        {piso.errorPedido[activo.clave] && <p className="piso-error" role="alert">{piso.errorPedido[activo.clave]}</p>}
        <footer className="piso-pie">
          <div><span>Total</span><strong>Bs {bs(total)}</strong>{sinPrecio > 0 && <small>{sinPrecio} sin precio</small>}</div>
          <button type="button" className="piso-enviar" disabled={enviando || !activo.lineas.length || sinPrecio > 0 || motivoNoEnviar(activo) != null} onClick={() => void enviar()}>{enviando ? 'Enviando…' : 'Enviar a caja'}</button>
        </footer>
      </>
      : <VistaEnviado pedido={activo} esReponedor={esReponedor} agregadoCaja={agregadoCaja} error={piso.errorPedido[activo.clave]} onRetirar={() => void piso.retirar()} onAnular={() => { if (window.confirm('¿Anular este pedido?')) void piso.anular() }} onNuevo={piso.nuevo} />}

    {hoja?.tipo === 'cantidad' && lineaDe(hoja.localId) && <HojaCantidad linea={lineaDe(hoja.localId)!} onClose={() => setHoja(null)} onCantidad={(c) => piso.cambiarCantidad(hoja.localId, c)} onPresentacion={(p) => piso.cambiarPresentacion(hoja.localId, p)} />}
    {hoja?.tipo === 'precio' && lineaDe(hoja.localId) && <HojaPrecio linea={lineaDe(hoja.localId)!} conPiso={conPiso} onClose={() => setHoja(null)} onPrecio={(p) => piso.cambiarPrecio(hoja.localId, p)} />}
    {hoja?.tipo === 'personalizado' && <HojaPersonalizado onClose={() => setHoja(null)} onAgregar={(i) => { piso.agregarPersonalizado(i); setHoja(null) }} />}
    {hoja?.tipo === 'pedidos' && <HojaPedidos esReponedor={esReponedor} pedidos={piso.pedidos} activa={activo.clave} cargando={piso.cargando} onClose={() => setHoja(null)} onElegir={(c) => { piso.activar(c); setHoja(null) }} onNuevo={() => { piso.nuevo(); setHoja(null) }} />}
    {hojaNoRealizada}
    {salirHoja}
    {nav}
    {ambiguos && <AmbiguousScanPicker productIds={ambiguos} onPick={(p) => { setAmbiguos(null); void agregarSiSeVende(p) }} onClose={() => setAmbiguos(null)} />}
  </div>
}

function Buscador({ onElegir, onAnotar }: { onElegir: (p: Product) => void; onAnotar: (texto: string, producto?: Product) => void }) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Product[]>([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  const [sinStock, setSinStock] = useState<Set<number>>(new Set())
  const [consulta, setConsulta] = useState('')
  useEffect(() => {
    const q = texto.trim()
    if (!q) return
    let cancelado = false
    const id = window.setTimeout(() => {
      setBuscando(true)
      productRepository.search({ query: q, active: true, page: { page: 1, pageSize: 20 } })
        .then((page) => {
          if (cancelado) return
          setResultados(page.items); setConsulta(q); setError(''); setSinStock(new Set())
          // Mejor esfuerzo: si el stock falla, simplemente no se ofrece "Anotar".
          if (!page.items.length) return
          getStockBySucursalBatch(page.items.map((p) => p.id))
            .then((lote) => { if (!cancelado) setSinStock(new Set(page.items.filter((p) => { const s = lote.get(p.id); return s != null && s.tiendaVendible + s.almacenVendible === 0 }).map((p) => p.id))) })
            .catch(() => {})
        })
        .catch(() => { if (!cancelado) { setResultados([]); setError('No se pudo buscar. Reintenta.') } })
        .finally(() => { if (!cancelado) setBuscando(false) })
    }, 250)
    return () => { cancelado = true; window.clearTimeout(id) }
  }, [texto])
  return <div className="piso-buscador">
    <label><Search aria-hidden="true" /><input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" placeholder="Buscar por nombre o código" aria-label="Buscar producto" value={texto} onChange={(e) => setTexto(e.target.value)} /></label>
    {error && <p className="piso-error" role="alert">{error}</p>}
    {texto.trim() && <ul className="piso-resultados" aria-busy={buscando}>
      {resultados.map((p) => <li key={p.id} className="piso-resultado-fila"><FotoProductoPiso nombre={p.nombre} sku={p.sku} precio={p.precioRetail} miniaturaUrl={p.imagenMiniaturaUrl} imagenUrl={p.imagenUrl} textoAccion="Agregar a la venta" onAccion={() => { onElegir(p); setTexto(''); setResultados([]) }} /><button type="button" className="piso-resultado-principal" onClick={() => { onElegir(p); setTexto(''); setResultados([]) }}><strong>{p.nombre}</strong><small>{p.sku}</small><b>{p.precioRetail > 0 ? `Bs ${bs(p.precioRetail)}` : 'Sin precio'}</b></button>{sinStock.has(p.id) && <button type="button" className="piso-anotar-fila" aria-label={`Anotar ${p.nombre}`} onClick={() => onAnotar(p.nombre, p)}>Anotar</button>}</li>)}
      {!buscando && consulta === texto.trim() && !resultados.length && !error && <li className="piso-vacio">Sin resultados<button type="button" className="piso-secundario piso-anotar-vacio" onClick={() => onAnotar(texto.trim())}>Anotar que lo buscaron</button></li>}
    </ul>}
  </div>
}

function FilaLinea({ linea, stock, esAlmacen, onMover, onCantidad, onPrecio, onQuitar }: { linea: LineaPiso; stock?: StockLinea; esAlmacen: boolean; onMover: () => void; onCantidad: () => void; onPrecio: () => void; onQuitar: () => void }) {
  const sinPrecio = linea.precioUnitario == null || linea.precioUnitario <= 0
  const subtotal = sinPrecio ? 0 : round2((linea.precioUnitario as number) * linea.cantidad)
  return <article className="piso-linea">
    <div className="piso-linea-nombre piso-con-foto">{!linea.esPersonalizado && <FotoProductoPiso nombre={linea.nombre} sku={linea.sku} precio={linea.precioLista} productoId={linea.productoId} />}<div><strong>{linea.nombre}</strong><small>{linea.esPersonalizado ? `Fuera de catálogo · ${linea.unidadMedida ?? 'UNIDAD'}` : linea.presentacionNombre ?? 'Unidad'}</small>{stock && <small className="piso-stock">{esAlmacen ? `En almacén: ${fmtQty(stock.almacen)}` : `En tienda: ${fmtQty(stock.tienda)}`}</small>}</div></div>
    <button type="button" className="piso-quitar" aria-label={`Quitar ${linea.nombre}`} onClick={onQuitar}><Trash2 /></button>
    <button type="button" className="piso-chip" onClick={onCantidad} aria-label={`Cantidad de ${linea.nombre}`}>× {linea.cantidad}</button>
    <button type="button" className={`piso-chip ${sinPrecio ? 'alerta' : ''}`} onClick={onPrecio} aria-label={`Precio de ${linea.nombre}`}>{sinPrecio ? 'Poner precio' : `Bs ${bs(linea.precioUnitario as number)}`}</button>
    <b className="piso-subtotal">Bs {bs(subtotal)}</b>
    {linea.error && <p className="piso-error" role="alert">{linea.error}</p>}
    {!esAlmacen && sePuedeMoverAAlmacen(linea, stock) && <div className="piso-mover"><p>En tienda no hay, en almacén sí ({fmtQty(stock?.almacen ?? 0)}). Pásalo a una venta de almacén.</p><button type="button" onClick={onMover}>Mover</button></div>}
  </article>
}

function Hoja({ titulo, onClose, children, acciones }: { titulo: string; onClose: () => void; children: React.ReactNode; acciones?: React.ReactNode }) {
  return <Modal title={titulo} onClose={onClose} className="piso-hoja"><div className="modal-body piso-hoja-cuerpo">{children}</div>{acciones && <footer className="modal-actions">{acciones}</footer>}</Modal>
}

function HojaCantidad({ linea, onClose, onCantidad, onPresentacion }: { linea: LineaPiso; onClose: () => void; onCantidad: (c: number) => void; onPresentacion: (p: PresentacionPiso) => void }) {
  const [texto, setTexto] = useState(String(linea.cantidad))
  const [cargadas, setCargadas] = useState<PresentacionPiso[] | null>(null)
  const presentaciones = (linea.productoId != null ? cachePresentaciones.get(linea.productoId) : undefined) ?? cargadas
  useEffect(() => {
    if (linea.esPersonalizado || linea.productoId == null) return
    const id = linea.productoId
    if (cachePresentaciones.has(id)) return
    let cancelado = false
    void listPresentations(id).then((lista) => { cachePresentaciones.set(id, lista); if (!cancelado) setCargadas(lista) }).catch(() => { if (!cancelado) setCargadas([]) })
    return () => { cancelado = true }
  }, [linea.esPersonalizado, linea.productoId])
  const valor = Number(texto.replace(',', '.'))
  const valido = Number.isFinite(valor) && valor > 0
  const activaId = linea.presentacionId
  return <Hoja titulo="Cantidad" onClose={onClose} acciones={<button type="button" className="piso-enviar" disabled={!valido} onClick={() => { onCantidad(valor); onClose() }}>Listo</button>}>
    <p className="piso-hoja-sub">{linea.nombre}</p>
    <input autoFocus className="piso-input" type="text" inputMode="decimal" aria-label="Cantidad" value={texto} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setTexto(e.target.value)} />
    {presentaciones && presentaciones.length > 1 && <div className="piso-chips" role="group" aria-label="Presentación">
      {opcionesDelLado(presentaciones, activaId ?? presentaciones.find((x) => x.esBase)?.id, 'tienda').map((p) => {
        const esActiva = p.esBase || p.factorUnidadBase === 1 ? activaId == null : activaId === p.id
        return <button key={p.id} type="button" aria-pressed={esActiva} className={esActiva ? 'activo' : ''} onClick={() => { onPresentacion(p) }}>{p.nombre}{!p.esBase && p.factorUnidadBase !== 1 ? ` (${p.factorUnidadBase})` : ''}</button>
      })}
    </div>}
    {linea.factor !== 1 && <small className="piso-hoja-sub">Cambiar la presentación vuelve el precio al de lista.</small>}
  </Hoja>
}

function HojaPrecio({ linea, conPiso, onClose, onPrecio }: { linea: LineaPiso; conPiso: boolean; onClose: () => void; onPrecio: (p: number) => void }) {
  const [texto, setTexto] = useState(linea.precioUnitario != null ? String(linea.precioUnitario) : '')
  const valor = Number(texto.replace(',', '.'))
  const hayValor = Number.isFinite(valor) && valor > 0
  const bajo = hayValor && bajoElMinimo(valor, linea.precioMinimo)
  const bloqueado = conPiso && bajo
  const descuento = hayValor && linea.precioLista != null && linea.precioLista > 0 && valor < linea.precioLista ? Math.round(((linea.precioLista - valor) / linea.precioLista) * 1000) / 10 : 0
  const nota = linea.esPersonalizado ? null : linea.precioLista == null ? 'Sin precio de lista: propón el precio' : !linea.esBase ? 'Precio de paquete: sin mínimo' : null
  return <Hoja titulo="Precio" onClose={onClose} acciones={<button type="button" className="piso-enviar" disabled={!hayValor || bloqueado} onClick={() => { onPrecio(valor); onClose() }}>Listo</button>}>
    <p className="piso-hoja-sub">{linea.nombre}</p>
    <input autoFocus className="piso-input" type="text" inputMode="decimal" aria-label="Precio unitario (Bs)" value={texto} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setTexto(e.target.value)} />
    <dl className="piso-precios">
      {linea.precioLista != null && <div><dt>Precio de lista</dt><dd>Bs {bs(linea.precioLista)}</dd></div>}
      {linea.precioMinimo != null && <div><dt>Mínimo</dt><dd>Bs {bs(linea.precioMinimo)}</dd></div>}
      {descuento > 0 && <div><dt>Descuento</dt><dd>{descuento.toLocaleString('es-BO')} %</dd></div>}
    </dl>
    {nota && <p className="piso-hoja-sub">{nota}</p>}
    {bajo && <p className="piso-error" role="alert">{conPiso ? `El mínimo para este producto es Bs ${bs(linea.precioMinimo as number)}.` : `Está por debajo del mínimo (Bs ${bs(linea.precioMinimo as number)}).`}</p>}
  </Hoja>
}

function HojaPersonalizado({ onClose, onAgregar }: { onClose: () => void; onAgregar: (i: { descripcion: string; unidadMedida: string; cantidad: number; precio: number }) => void }) {
  const [descripcion, setDescripcion] = useState('')
  const [unidad, setUnidad] = useState('UNIDAD')
  const [cantidad, setCantidad] = useState('1')
  const [precio, setPrecio] = useState('')
  const c = Number(cantidad.replace(',', '.'))
  const p = Number(precio.replace(',', '.'))
  const valido = descripcion.trim().length >= 2 && c > 0 && p > 0
  return <Hoja titulo="Producto fuera de catálogo" onClose={onClose} acciones={<button type="button" className="piso-enviar" disabled={!valido} onClick={() => onAgregar({ descripcion: descripcion.trim(), unidadMedida: unidad || 'UNIDAD', cantidad: c, precio: p })}>Agregar</button>}>
    <label className="piso-campo">Descripción<input className="piso-input" type="text" autoFocus value={descripcion} maxLength={120} onChange={(e) => setDescripcion(e.target.value)} /></label>
    <label className="piso-campo">Unidad<UnitOfMeasureField value={unidad} onChange={setUnidad} /></label>
    <label className="piso-campo">Cantidad<input className="piso-input" type="text" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></label>
    <label className="piso-campo">Precio unitario (Bs)<input className="piso-input" type="text" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} /></label>
  </Hoja>
}

function HojaPedidos({ esReponedor, pedidos, activa, cargando, onClose, onElegir, onNuevo }: { esReponedor: boolean; pedidos: PedidoLocal[]; activa: string; cargando: boolean; onClose: () => void; onElegir: (clave: string) => void; onNuevo: () => void }) {
  const palabra = esReponedor ? 'Venta' : 'Pedido'
  return <Hoja titulo="Mis pedidos" onClose={onClose} acciones={<button type="button" className="piso-enviar" onClick={onNuevo}><Plus /> Nuevo pedido</button>}>
    {cargando && <p className="piso-hoja-sub" role="status">Actualizando…</p>}
    <ul className="piso-pedidos">
      {[...pedidos].reverse().map((p) => {
        const total = p.estado === 'ARMANDO' ? totalPedido(p.lineas).total : p.snapshot?.total ?? totalPedido(p.lineas).total
        return <li key={p.clave}><button type="button" aria-current={p.clave === activa} onClick={() => onElegir(p.clave)}>
          <strong>{p.numeroDia != null ? `${palabra} ${p.numeroDia}` : esReponedor ? 'Venta nueva' : 'Pedido nuevo'}{p.canal === 'ALMACEN' && <em className="piso-etiqueta-almacen">De almacén</em>}</strong><span className={`piso-estado ${p.estado.toLowerCase()}`}>{ETIQUETA_ESTADO[p.estado]}</span><b>Bs {bs(total)}</b>
        </button></li>
      })}
    </ul>
  </Hoja>
}

function NavegacionPiso({ vista, textoArmar, onElegir }: { vista: Vista; textoArmar: string; onElegir: (v: Vista) => void }) {
  const secciones: Array<{ id: Vista; texto: string }> = [{ id: 'inicio', texto: 'Inicio' }, { id: 'vender', texto: textoArmar }, { id: 'traslados', texto: 'Traslados' }, { id: 'ventas', texto: 'Mis ventas' }]
  return <nav className="piso-nav" aria-label="Secciones">
    {secciones.map((n) => <button key={n.id} type="button" aria-current={vista === n.id ? 'page' : undefined} className={vista === n.id ? 'activo' : ''} onClick={() => onElegir(n.id)}>{n.texto}</button>)}
  </nav>
}

const TEXTO_SIN_ANULAR = 'Tú no cobras ni anulas. Si te equivocaste, retírala de caja y corrígela; solo caja puede anularla. Si nadie la cobra, se cierra sola en la noche.'

interface VistaEnviadoProps {
  pedido: PedidoLocal
  esReponedor: boolean
  agregadoCaja: number | null
  error?: string
  onRetirar: () => void
  onAnular: () => void
  onNuevo: () => void
}

function VistaEnviado({ pedido, esReponedor, agregadoCaja, error, onRetirar, onAnular, onNuevo }: VistaEnviadoProps) {
  const s = pedido.snapshot
  const estado = pedido.estado
  const texto = estado === 'ENVIADO' ? 'En espera de caja'
    : estado === 'EN_CAJA' ? 'En caja'
      : estado === 'COBRADO' ? `Cobrado${s?.ventaNumero ? ` · ${s.ventaNumero}` : ''}`
        : `Anulado${s?.anuladoMotivo ? `: ${s.anuladoMotivo}` : ''}`
  const esAlmacen = pedido.canal === 'ALMACEN'
  const ventaAnulada = s?.ventaEstado === 'ANULADA'
  const parte = estado === 'COBRADO' && !ventaAnulada ? parteCobrada(s?.lineas ?? []) : null
  const totalVenta = parte != null && agregadoCaja != null ? round2(parte + agregadoCaja) : s?.total ?? 0
  const palabra = esReponedor ? 'venta' : 'pedido'
  return <section className="piso-enviado" aria-live="polite">
    <p className="piso-numero-dia" aria-label={`Número de la ${palabra} ${pedido.numeroDia ?? ''}`}>{pedido.numeroDia ?? '—'}</p>
    <p className={`piso-estado-grande ${estado.toLowerCase()}`}>{texto}</p>
    {esAlmacen && estado !== 'ANULADO' && <PasosAlmacen estado={estado} entregado={s?.entregado === true} />}
    {esAlmacen && estado === 'COBRADO' && <section className="piso-ticket-almacen" aria-label="Entrega en almacén">
      {s?.ventaNumero && <p><strong>Ticket de caja {s.ventaNumero}</strong></p>}
      {ventaAnulada ? <p>Caja anuló esta venta: ya no cuenta para ti.</p> : s?.entregado ? <p>Almacén entregó {horaCorta(s.entregadoEn)}</p> : <p>El cliente ya pagó. Almacén le entrega con este ticket.</p>}
    </section>}
    {pedido.codigo && estado !== 'ANULADO' && !(esAlmacen && estado === 'COBRADO') && <div className="piso-qr"><DocQr content={pedido.codigo} size={240} /><small>{pedido.codigo}</small></div>}
    <ul className="piso-resumen">
      {(s?.lineas ?? []).map((l) => <li key={l.orden}><span>{l.cantidadFinal ?? l.cantidad} × {l.nombre}</span><b>Bs {bs(l.precioFinal != null ? round2(l.precioFinal * (l.cantidadFinal ?? l.cantidad)) : l.subtotal)}</b></li>)}
    </ul>
    <p className="piso-total-enviado"><span>Total</span><strong>Bs {bs(s?.total ?? 0)}</strong></p>
    {parte != null && <p className="piso-parte"><strong>Tu parte: Bs {bs(parte)} de Bs {bs(totalVenta)}</strong>{agregadoCaja != null && agregadoCaja > 0 && <small>Caja agregó productos (Bs {bs(agregadoCaja)}), no cuentan para ti</small>}</p>}
    {error && <p className="piso-error" role="alert">{error}</p>}
    {esReponedor && estado !== 'COBRADO' && estado !== 'ANULADO' && <p className="piso-nota-rol">{TEXTO_SIN_ANULAR}</p>}
    <div className="piso-acciones">
      {estado === 'ENVIADO' && <button type="button" className="piso-secundario" onClick={onRetirar}>{esReponedor ? 'Retirar de caja para corregir' : 'Retirar para editar'}</button>}
      {!esReponedor && (estado === 'ARMANDO' || estado === 'ENVIADO') && <button type="button" className="piso-secundario peligro" onClick={onAnular}>Anular pedido</button>}
      <button type="button" className="piso-enviar" onClick={onNuevo}>{esReponedor ? 'Venta nueva' : 'Nuevo pedido'}</button>
    </div>
  </section>
}

const PASOS_ALMACEN = ['Enviada a caja', 'Caja cobra', 'Almacén entrega']

/** Avance de una venta de almacén: enviada → cobrada en caja → entregada por almacén. */
function PasosAlmacen({ estado, entregado }: { estado: PedidoVendedorEstado; entregado: boolean }) {
  const hechos = [estado === 'ENVIADO' || estado === 'EN_CAJA' || estado === 'COBRADO', estado === 'COBRADO', entregado]
  const actual = hechos.findIndex((h) => !h)
  return <ol className="piso-pasos" aria-label="Avance de la venta de almacén">
    {PASOS_ALMACEN.map((texto, i) => <li key={texto} className={hechos[i] ? 'hecho' : i === actual ? 'actual' : ''} aria-current={i === actual ? 'step' : undefined}>{texto}</li>)}
  </ol>
}
