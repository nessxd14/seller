import { Flashlight, FlashlightOff, ListOrdered, Plus, ScanLine, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import type { PedidoVendedorEstado } from '../../application/shared/models'
import { AmbiguousScanPicker } from '../../components/AmbiguousScanPicker'
import { DocQr } from '../../components/DocQr'
import { Modal } from '../../components/Modal'
import { UnitOfMeasureField } from '../../components/UnitOfMeasureField'
import { featureFlags } from '../../config/featureFlags'
import { bajoElMinimo, round2, totalPedido, type LineaPiso, type PedidoLocal, type PresentacionPiso, type ProductoPiso } from '../../domain/sales/pedidoPiso'
import { listPresentations, productRepository } from '../../infrastructure/services'
import { supabaseAuthSessionProvider } from '../../infrastructure/supabase/SupabaseAuthSessionProvider'
import type { Product } from '../../types'
import { EscanerContinuo, useWakeLock, vibrarDesconocido } from './EscanerContinuo'
import { usePedidosPiso } from './usePedidosPiso'

const bs = (v: number) => v.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const aProducto = (p: Product): ProductoPiso => ({ id: p.id, nombre: p.nombre, sku: p.sku, precioRetail: p.precioRetail })
const ETIQUETA_ESTADO: Record<PedidoVendedorEstado, string> = { ARMANDO: 'Armando', ENVIADO: 'En espera de caja', EN_CAJA: 'En caja', COBRADO: 'Cobrado', ANULADO: 'Anulado' }

// Presentaciones por producto: se piden la primera vez que se abre la hoja y se reutilizan.
const cachePresentaciones = new Map<number, PresentacionPiso[]>()

type Hoja =
  | { tipo: 'cantidad'; localId: string }
  | { tipo: 'precio'; localId: string }
  | { tipo: 'personalizado' }
  | { tipo: 'pedidos' }
  | null

export function PedidoPisoApp({ session }: { session: AuthSession }) {
  useWakeLock()
  const piso = usePedidosPiso(session.user.id)
  const { activo } = piso
  // Vendedor y cajero no pueden bajar del mínimo (lista − 10 %); gerente y admin sí.
  const conPiso = session.user.role === 'vendedor' || session.user.role === 'cajero'
  const [hoja, setHoja] = useState<Hoja>(null)
  const [plegado, setPlegado] = useState(false)
  const [linterna, setLinterna] = useState(false)
  const [linternaSoportada, setLinternaSoportada] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ambiguos, setAmbiguos] = useState<number[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const avisoTimer = useRef<number | undefined>(undefined)

  const avisar = useCallback((mensaje: string) => {
    setAviso(mensaje)
    window.clearTimeout(avisoTimer.current)
    avisoTimer.current = window.setTimeout(() => setAviso(''), 2600)
  }, [])
  useEffect(() => () => window.clearTimeout(avisoTimer.current), [])

  const { agregar } = piso
  const alEscanear = useCallback(async (codigo: string) => {
    try {
      const r = await productRepository.resolveScannedCode(codigo)
      if (r.kind === 'found') { agregar(aProducto(r.product), r.presentation); avisar(`Agregado: ${r.product.nombre}`) }
      else if (r.kind === 'ambiguous') setAmbiguos(r.productIds)
      else { vibrarDesconocido(); avisar('Código no reconocido') }
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo leer el código') }
  }, [agregar, avisar])

  const editable = activo.estado === 'ARMANDO'
  const lineaDe = (localId: string) => activo.lineas.find((l) => l.localId === localId)
  const { total, sinPrecio } = totalPedido(activo.lineas)
  const titulo = activo.numeroDia != null ? `Pedido ${activo.numeroDia}` : 'Pedido nuevo'

  const enviar = async () => { setEnviando(true); try { await piso.enviar() } finally { setEnviando(false) } }

  return <div className="piso-app">
    <header className="piso-header">
      <div><h1>{titulo}</h1><small>{activo.lineas.length} {activo.lineas.length === 1 ? 'línea' : 'líneas'} · {ETIQUETA_ESTADO[activo.estado]}</small></div>
      {linternaSoportada && editable && !plegado && <button type="button" className="piso-icono" aria-pressed={linterna} aria-label={linterna ? 'Apagar linterna' : 'Encender linterna'} onClick={() => setLinterna((v) => !v)}>{linterna ? <FlashlightOff /> : <Flashlight />}</button>}
      <button type="button" className="piso-icono con-texto" onClick={() => setHoja({ tipo: 'pedidos' })}><ListOrdered /> <span>Mis pedidos</span>{piso.abiertos > 1 && <b>{piso.abiertos}</b>}</button>
    </header>

    {piso.sinConexion && <p className="piso-banner" role="status">Sin conexión. Guardado en este teléfono</p>}
    {aviso && <p className="piso-toast" role="status">{aviso}</p>}

    {editable
      ? <>
        <section className="piso-captura" aria-label="Agregar productos">
          <button type="button" className="piso-plegar" aria-expanded={!plegado} onClick={() => setPlegado((v) => !v)}><ScanLine /> {plegado ? 'Abrir cámara' : 'Ocultar cámara'}</button>
          <EscanerContinuo onCodigo={(c) => void alEscanear(c)} plegado={plegado} linterna={linterna} onSoporteLinterna={setLinternaSoportada} />
          <Buscador onElegir={(p) => { agregar(aProducto(p)); avisar(`Agregado: ${p.nombre}`) }} />
        </section>
        <section className="piso-lineas" aria-label="Productos del pedido">
          {!activo.lineas.length && <p className="piso-vacio">Escanea un código o busca un producto para empezar.</p>}
          {[...activo.lineas].reverse().map((l) => <FilaLinea key={l.localId} linea={l} onCantidad={() => setHoja({ tipo: 'cantidad', localId: l.localId })} onPrecio={() => setHoja({ tipo: 'precio', localId: l.localId })} onQuitar={() => piso.quitar(l.localId)} />)}
          <button type="button" className="piso-fuera-catalogo" onClick={() => setHoja({ tipo: 'personalizado' })}><Plus /> Producto fuera de catálogo</button>
        </section>
        {piso.errorPedido[activo.clave] && <p className="piso-error" role="alert">{piso.errorPedido[activo.clave]}</p>}
        <footer className="piso-pie">
          <div><span>Total</span><strong>Bs {bs(total)}</strong>{sinPrecio > 0 && <small>{sinPrecio} sin precio</small>}</div>
          <button type="button" className="piso-enviar" disabled={enviando || !activo.lineas.length || sinPrecio > 0} onClick={() => void enviar()}>{enviando ? 'Enviando…' : 'Enviar a caja'}</button>
        </footer>
      </>
      : <VistaEnviado pedido={activo} error={piso.errorPedido[activo.clave]} onRetirar={() => void piso.retirar()} onAnular={() => { if (window.confirm('¿Anular este pedido?')) void piso.anular() }} onNuevo={piso.nuevo} />}

    {hoja?.tipo === 'cantidad' && lineaDe(hoja.localId) && <HojaCantidad linea={lineaDe(hoja.localId)!} onClose={() => setHoja(null)} onCantidad={(c) => piso.cambiarCantidad(hoja.localId, c)} onPresentacion={(p) => piso.cambiarPresentacion(hoja.localId, p)} />}
    {hoja?.tipo === 'precio' && lineaDe(hoja.localId) && <HojaPrecio linea={lineaDe(hoja.localId)!} conPiso={conPiso} onClose={() => setHoja(null)} onPrecio={(p) => piso.cambiarPrecio(hoja.localId, p)} />}
    {hoja?.tipo === 'personalizado' && <HojaPersonalizado onClose={() => setHoja(null)} onAgregar={(i) => { piso.agregarPersonalizado(i); setHoja(null) }} />}
    {hoja?.tipo === 'pedidos' && <HojaPedidos pedidos={piso.pedidos} activa={activo.clave} cargando={piso.cargando} onClose={() => setHoja(null)} onElegir={(c) => { piso.activar(c); setHoja(null) }} onNuevo={() => { piso.nuevo(); setHoja(null) }} />}
    {ambiguos && <AmbiguousScanPicker productIds={ambiguos} onPick={(p) => { agregar(aProducto(p)); setAmbiguos(null); avisar(`Agregado: ${p.nombre}`) }} onClose={() => setAmbiguos(null)} />}
  </div>
}

function Buscador({ onElegir }: { onElegir: (p: Product) => void }) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Product[]>([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const q = texto.trim()
    if (!q) return
    let cancelado = false
    const id = window.setTimeout(() => {
      setBuscando(true)
      productRepository.search({ query: q, active: true, page: { page: 1, pageSize: 20 } })
        .then((page) => { if (!cancelado) { setResultados(page.items); setError('') } })
        .catch(() => { if (!cancelado) { setResultados([]); setError('No se pudo buscar. Reintenta.') } })
        .finally(() => { if (!cancelado) setBuscando(false) })
    }, 250)
    return () => { cancelado = true; window.clearTimeout(id) }
  }, [texto])
  return <div className="piso-buscador">
    <label><Search aria-hidden="true" /><input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" placeholder="Buscar por nombre o código" aria-label="Buscar producto" value={texto} onChange={(e) => setTexto(e.target.value)} /></label>
    {error && <p className="piso-error" role="alert">{error}</p>}
    {texto.trim() && <ul className="piso-resultados" aria-busy={buscando}>
      {resultados.map((p) => <li key={p.id}><button type="button" onClick={() => { onElegir(p); setTexto(''); setResultados([]) }}><strong>{p.nombre}</strong><small>{p.sku}</small><b>{p.precioRetail > 0 ? `Bs ${bs(p.precioRetail)}` : 'Sin precio'}</b></button></li>)}
      {!buscando && !resultados.length && !error && <li className="piso-vacio">Sin resultados</li>}
    </ul>}
  </div>
}

function FilaLinea({ linea, onCantidad, onPrecio, onQuitar }: { linea: LineaPiso; onCantidad: () => void; onPrecio: () => void; onQuitar: () => void }) {
  const sinPrecio = linea.precioUnitario == null || linea.precioUnitario <= 0
  const subtotal = sinPrecio ? 0 : round2((linea.precioUnitario as number) * linea.cantidad)
  return <article className="piso-linea">
    <div className="piso-linea-nombre"><strong>{linea.nombre}</strong><small>{linea.esPersonalizado ? `Fuera de catálogo · ${linea.unidadMedida ?? 'UNIDAD'}` : linea.presentacionNombre ?? 'Unidad'}</small></div>
    <button type="button" className="piso-quitar" aria-label={`Quitar ${linea.nombre}`} onClick={onQuitar}><Trash2 /></button>
    <button type="button" className="piso-chip" onClick={onCantidad} aria-label={`Cantidad de ${linea.nombre}`}>× {linea.cantidad}</button>
    <button type="button" className={`piso-chip ${sinPrecio ? 'alerta' : ''}`} onClick={onPrecio} aria-label={`Precio de ${linea.nombre}`}>{sinPrecio ? 'Poner precio' : `Bs ${bs(linea.precioUnitario as number)}`}</button>
    <b className="piso-subtotal">Bs {bs(subtotal)}</b>
    {linea.error && <p className="piso-error" role="alert">{linea.error}</p>}
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
      {presentaciones.map((p) => {
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

function HojaPedidos({ pedidos, activa, cargando, onClose, onElegir, onNuevo }: { pedidos: PedidoLocal[]; activa: string; cargando: boolean; onClose: () => void; onElegir: (clave: string) => void; onNuevo: () => void }) {
  return <Hoja titulo="Mis pedidos" onClose={onClose} acciones={<button type="button" className="piso-enviar" onClick={onNuevo}><Plus /> Nuevo pedido</button>}>
    {cargando && <p className="piso-hoja-sub" role="status">Actualizando…</p>}
    <ul className="piso-pedidos">
      {[...pedidos].reverse().map((p) => {
        const total = p.estado === 'ARMANDO' ? totalPedido(p.lineas).total : p.snapshot?.total ?? totalPedido(p.lineas).total
        return <li key={p.clave}><button type="button" aria-current={p.clave === activa} onClick={() => onElegir(p.clave)}>
          <strong>{p.numeroDia != null ? `Pedido ${p.numeroDia}` : 'Pedido nuevo'}</strong><span className={`piso-estado ${p.estado.toLowerCase()}`}>{ETIQUETA_ESTADO[p.estado]}</span><b>Bs {bs(total)}</b>
        </button></li>
      })}
    </ul>
    {featureFlags.supabase && <button type="button" className="piso-salir" onClick={() => void supabaseAuthSessionProvider.signOut()}>Cerrar sesión</button>}
  </Hoja>
}

function VistaEnviado({ pedido, error, onRetirar, onAnular, onNuevo }: { pedido: PedidoLocal; error?: string; onRetirar: () => void; onAnular: () => void; onNuevo: () => void }) {
  const s = pedido.snapshot
  const estado = pedido.estado
  const texto = estado === 'ENVIADO' ? 'En espera de caja'
    : estado === 'EN_CAJA' ? `En caja${s?.tomadoPor ? ` con ${s.tomadoPor}` : ''}`
      : estado === 'COBRADO' ? `Cobrado${s?.ventaNumero ? ` · ${s.ventaNumero}` : ''}`
        : `Anulado${s?.anuladoMotivo ? `: ${s.anuladoMotivo}` : ''}`
  return <section className="piso-enviado" aria-live="polite">
    <p className="piso-numero-dia" aria-label={`Número del pedido ${pedido.numeroDia ?? ''}`}>{pedido.numeroDia ?? '—'}</p>
    <p className={`piso-estado-grande ${estado.toLowerCase()}`}>{texto}</p>
    {pedido.codigo && estado !== 'ANULADO' && <div className="piso-qr"><DocQr content={pedido.codigo} size={240} /><small>{pedido.codigo}</small></div>}
    <ul className="piso-resumen">
      {(s?.lineas ?? []).map((l) => <li key={l.orden}><span>{l.cantidadFinal ?? l.cantidad} × {l.nombre}</span><b>Bs {bs(l.precioFinal != null ? round2(l.precioFinal * (l.cantidadFinal ?? l.cantidad)) : l.subtotal)}</b></li>)}
    </ul>
    <p className="piso-total-enviado"><span>Total</span><strong>Bs {bs(s?.total ?? 0)}</strong></p>
    {error && <p className="piso-error" role="alert">{error}</p>}
    <div className="piso-acciones">
      {estado === 'ENVIADO' && <button type="button" className="piso-secundario" onClick={onRetirar}>Retirar para editar</button>}
      {(estado === 'ARMANDO' || estado === 'ENVIADO') && <button type="button" className="piso-secundario peligro" onClick={onAnular}>Anular pedido</button>}
      <button type="button" className="piso-enviar" onClick={onNuevo}>Nuevo pedido</button>
    </div>
  </section>
}
