import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ellipsis, Lock, PackagePlus, TriangleAlert, X } from 'lucide-react'
import { NumberField } from '../../../components/NumberField'
import { PrecioBajoAviso } from '../../../components/PrecioBajoAviso'
import { ProductQuickAdd } from '../../../components/ProductQuickAdd'
import type { ItemBorrador, MarcaItem } from '../../../domain/orders/edicionPedido'
import type { CambioPedido } from '../../../domain/orders/pedidoEdicion.types'
import { precioSugerido } from '../../../domain/pricing/precioPresentacion'
import { getDisponibilidadPedido, listPresentations, productRepository } from '../../../infrastructure/services'
import { navigate } from '../../../router/history'
import { pedidoPath } from '../../../router/appRoute'
import type { Product } from '../../../types'
import { FeatureShell, FeatureState } from '../../shared/FeatureShell'
import { Chip } from '../detalle/Chip'
import { bs, cant, deltaBs } from '../detalle/formato'
import { canalDeCategoria, priceForOrderChannel } from './canal'
import { ConfirmarEdicionModal } from './ConfirmarEdicionModal'
import { queryAIntento, type IntentoEdicion } from './intento'
import { ItemPersonalizadoModal } from './ItemPersonalizadoModal'
import { PartirItemModal, type PrefillPartir } from './PartirItemModal'
import { ProductoSaldoModal } from './ProductoSaldoModal'
import { useEdicionPedido } from './useEdicionPedido'

interface InfoPrecio { sugerido: number | null; presentacionNombre?: string; factor: number }

const MARCAS: Record<MarcaItem, { texto: string; tono: 'blue' | 'orange' | 'gray' }> = {
  NUEVO: { texto: 'Nuevo', tono: 'blue' },
  MODIFICADO: { texto: 'Modificado', tono: 'orange' },
  PARTIDO: { texto: 'Partido', tono: 'orange' },
  QUITADO: { texto: 'Quitado', tono: 'gray' },
}

/** Menú "⋯" de un ítem: cada acción con su explicación de una línea y su motivo si no está disponible. */
function MenuAcciones({ item, abierto, onAlternar, onCerrar, onPartir, onCambiarSaldo, onCerrarSaldo, onSaldoACompra, onQuitar }: {
  item: ItemBorrador
  abierto: boolean
  onAlternar: () => void
  onCerrar: () => void
  onPartir: () => void
  onCambiarSaldo: () => void
  onCerrarSaldo: () => void
  onSaldoACompra: () => void
  onQuitar: () => void
}) {
  const contenedor = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (evento: MouseEvent) => { if (!contenedor.current?.contains(evento.target as Node)) onCerrar() }
    const tecla = (evento: KeyboardEvent) => { if (evento.key === 'Escape') { onCerrar(); boton.current?.focus() } }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierto, onCerrar])
  const sinCubrir = item.cantidad_sin_cubrir > 0
  const entradas: Array<{ id: string; titulo: string; detalle: string; bloqueo: string | null; peligro?: boolean; accion: () => void }> = [
    { id: 'partir', titulo: 'Partir ítem', detalle: 'Reparte la cantidad en partes, cada una con su producto y precio.', bloqueo: item.cantidad_presentacion <= 0 ? 'No hay cantidad que repartir.' : null, accion: onPartir },
    { id: 'saldo', titulo: 'Cambiar producto del saldo', detalle: 'Lo que Almacén no cubrió pasa a otro producto.', bloqueo: sinCubrir ? null : 'No hay saldo sin cubrir.', accion: onCambiarSaldo },
    { id: 'cerrar', titulo: 'Cerrar saldo', detalle: 'Deja el ítem en lo ya despachado y cancela lo pendiente.', bloqueo: item.cantidad_despachada > 0 ? null : 'No hay unidades despachadas: usa Quitar ítem.', accion: onCerrarSaldo },
    ...(sinCubrir ? [{ id: 'compra', titulo: 'Mandar saldo a compra', detalle: 'Lo sin cubrir se vuelve a cobrar y se manda a comprar.', bloqueo: null, accion: onSaldoACompra }] : []),
    { id: 'quitar', titulo: 'Quitar ítem', detalle: 'Saca el ítem del pedido y cancela su surtido.', bloqueo: item.cantidad_despachada > 0 ? `No disponible: ${cant(item.cantidad_despachada)} ya salieron.` : null, peligro: true, accion: onQuitar },
  ]
  return <div className="ped-menu" ref={contenedor}>
    <button ref={boton} type="button" className="ped-btn ped-btn-icono" aria-label={`Más acciones para ${item.descripcion}`} aria-haspopup="menu" aria-expanded={abierto} onClick={onAlternar}><Ellipsis aria-hidden /></button>
    {abierto && <ul className="ped-menu-lista" role="menu" aria-label={`Acciones de ${item.descripcion}`}>
      {entradas.map((entrada) => <li key={entrada.id} role="none">
        <button type="button" role="menuitem" disabled={entrada.bloqueo != null} className={entrada.peligro ? 'peligro' : undefined} onClick={() => { onCerrar(); entrada.accion() }}>
          <strong>{entrada.titulo}</strong><small>{entrada.bloqueo ?? entrada.detalle}</small>
        </button>
      </li>)}
    </ul>}
  </div>
}

export function EditarPedidoView({ pedidoId, notify, onGuardado }: {
  pedidoId: number
  notify: (mensaje: string) => void
  /** Se llama tras guardar: la página refresca lista y cobros y vuelve al detalle. */
  onGuardado: (resultado: { version: number; total: number }) => void
}) {
  const { base, estado, cambios, resultado, resumen, agregarCambio, quitarCambio, reemplazarCambio, limpiar, setCantidad, setPrecio, setDatos, recargar } = useEdicionPedido(pedidoId)
  const [menuAbierto, setMenuAbierto] = useState<number | null>(null)
  const [partir, setPartir] = useState<{ itemId: number; prefill?: PrefillPartir } | null>(null)
  const [saldo, setSaldo] = useState<number | null>(null)
  const [personalizado, setPersonalizado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [info, setInfo] = useState<Record<number, InfoPrecio>>({})
  const [disponibilidad, setDisponibilidad] = useState<Record<string, { disponible: number }>>({})
  const intentoAplicado = useRef(false)

  const canal = base ? canalDeCategoria(base.pedido.categoria) : 'retail'
  const volverAlDetalle = useCallback((reemplazar = false) => navigate(pedidoPath(String(pedidoId)), { replace: reemplazar }), [pedidoId])

  // El servidor decide quién edita (permisos.puede_editar); si no, se vuelve al detalle con el motivo.
  useEffect(() => {
    if (base && !base.permisos.puede_editar) { notify(base.permisos.motivo_no_editable ?? 'No tienes permiso para editar este pedido.'); volverAlDetalle(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notify es estable por convención en este módulo
  }, [base, volverAlDetalle])

  // Los atajos de los avisos abren la sesión ya encaminada (una sola vez).
  useEffect(() => {
    if (!base || !resultado || intentoAplicado.current || !base.permisos.puede_editar) return
    intentoAplicado.current = true
    const intento: IntentoEdicion | null = queryAIntento(window.location.search)
    if (!intento) return
    window.history.replaceState({}, '', window.location.pathname)
    const item = base.items.find((candidato) => candidato.id === intento.itemId)
    if (!item) { notify('El ítem del aviso ya no está en el pedido.'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el atajo del aviso abre su paso una única vez al cargar
    if (intento.tipo === 'precio_propio') setPartir({ itemId: item.id, prefill: { lineaId: intento.lineaId } })
    else if (intento.tipo === 'reemplazar') setSaldo(item.id)
    else agregarCambio({ op: 'saldo_a_compra', item_id: item.id })
  }, [base, resultado, agregarCambio, notify])

  useEffect(() => {
    if (!cambios.length) return
    const avisar = (evento: BeforeUnloadEvent) => { evento.preventDefault() }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [cambios.length])

  const nuevosProductoIds = useMemo(() => Array.from(new Set(cambios.flatMap((cambio) => (cambio.op === 'agregar' && cambio.producto_id != null ? [cambio.producto_id] : [])))).sort((a, b) => a - b), [cambios])
  const nuevosKey = nuevosProductoIds.join(',')
  useEffect(() => {
    if (!nuevosKey) return
    let cancelado = false
    void getDisponibilidadPedido(nuevosKey.split(',').map(Number))
      .then((respuesta) => { if (!cancelado) setDisponibilidad(respuesta) })
      .catch(() => { if (!cancelado) setDisponibilidad({}) })
    return () => { cancelado = true }
  }, [nuevosKey])

  // Opción A (faltante de stock), igual que DraftOrderEditor: comprar el faltante / bajar la cantidad / cambiar el producto.
  const faltanteDe = (item: ItemBorrador): { faltante: number; disponible: number; factor: number } | null => {
    if (item.id >= 0 || item.producto_id == null || item.es_personalizado || item.origenCambio == null) return null
    const origen = cambios[item.origenCambio]
    if (!origen || origen.op !== 'agregar' || origen.faltante === 'COMPRAR') return null
    const disponible = disponibilidad[String(item.producto_id)]?.disponible
    if (disponible == null) return null
    const factor = info[item.producto_id]?.factor ?? 1
    const faltante = item.cantidad_presentacion * factor - disponible
    return faltante > 0 ? { faltante, disponible, factor } : null
  }

  // Búsqueda de producto para "Agregar ítem" (mismo patrón que AddItemsModal).
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<Product[]>([])
  const [buscando, setBuscando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState('')
  useEffect(() => {
    let cancelado = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia al vaciar el término, sin esperar al debounce
    setErrorBusqueda('')
    if (!consulta.trim()) { setResultados([]); setBuscando(false); return }
    setBuscando(true)
    const espera = setTimeout(() => {
      void productRepository.search({ query: consulta, active: true, page: { page: 1, pageSize: 100 } })
        .then((pagina) => { if (!cancelado) { setResultados(pagina.items); setBuscando(false) } })
        .catch(() => { if (!cancelado) { setResultados([]); setBuscando(false); setErrorBusqueda('No se pudo buscar. Intenta nuevamente.') } })
    }, 250)
    return () => { cancelado = true; clearTimeout(espera) }
  }, [consulta])

  const agregarProducto = async (producto: Product) => {
    const existente = cambios.findIndex((cambio) => cambio.op === 'agregar' && cambio.producto_id === producto.id)
    const actual = existente >= 0 ? cambios[existente] : null
    if (actual && actual.op === 'agregar') { reemplazarCambio(existente, { ...actual, cantidad_presentacion: actual.cantidad_presentacion + 1 }); return }
    const presentaciones = await listPresentations(producto.id)
    const presentacion = presentaciones.find((p) => p.esBase) ?? presentaciones[0]
    const precioCanal = priceForOrderChannel(producto, canal)
    const sugerido = precioSugerido(presentacion, canal, precioCanal)
    setInfo((previa) => ({ ...previa, [producto.id]: { sugerido, presentacionNombre: presentacion && !presentacion.esBase ? presentacion.nombre : undefined, factor: presentacion?.factorUnidadBase ?? 1 } }))
    agregarCambio({
      op: 'agregar', producto_id: producto.id, presentacion_id: presentacion?.id || null, cantidad_presentacion: 1, precio_unitario: sugerido ?? precioCanal, descuento_pct: 0,
      es_personalizado: false, descripcion: null, unidad_medida: null, faltante: null, nombre: producto.nombre, presentacion_nombre: presentacion && !presentacion.esBase ? presentacion.nombre : undefined,
    })
  }

  const indiceDeCambio = (predicado: (cambio: CambioPedido) => boolean): number => {
    let indice = -1
    cambios.forEach((cambio, i) => { if (predicado(cambio)) indice = i })
    return indice
  }

  if (estado === 'cargando') return <FeatureShell className="orders-page ped-edicion" eyebrow="PEDIDOS" title="Editar pedido" subtitle="Cargando el pedido…"><FeatureState type="skeleton" text="Cargando pedido" /></FeatureShell>
  if (estado === 'error' || !base || !resultado) return <FeatureShell className="orders-page ped-edicion" eyebrow="PEDIDOS" title="Editar pedido" subtitle="No se pudo cargar"><FeatureState type="error" text="No se pudo cargar el pedido" /><button type="button" className="ped-btn ped-btn-suave" onClick={() => volverAlDetalle()}>Volver al pedido</button></FeatureShell>
  if (!base.permisos.puede_editar) return <FeatureShell className="orders-page ped-edicion" eyebrow="PEDIDOS" title="Editar pedido" subtitle="Sin permiso"><FeatureState type="loading" text="Volviendo al pedido" /></FeatureShell>

  const { pedido, permisos } = base
  const itemPartir = partir ? resultado.items.find((item) => item.id === partir.itemId) : undefined
  const itemSaldo = saldo != null ? resultado.items.find((item) => item.id === saldo) : undefined
  const hayFaltanteSinDecidir = resultado.items.some((item) => faltanteDe(item) != null)
  const puedeRevisar = cambios.length > 0 && resultado.errores.length === 0 && !hayFaltanteSinDecidir
  const diferencia = Math.round((resultado.totalLocal - pedido.total) * 100) / 100
  const descartar = () => {
    if (cambios.length > 0 && !window.confirm(`Tienes ${cambios.length} cambio${cambios.length === 1 ? '' : 's'} sin guardar. ¿Descartarlos?`)) return
    limpiar()
    volverAlDetalle()
  }
  const aplicar = (cambio: CambioPedido) => { agregarCambio(cambio); setPartir(null); setSaldo(null); setPersonalizado(false) }

  const fila = (item: ItemBorrador) => {
    const marca = resultado.porItem.get(item.id)
    const quitado = item.estado === 'QUITADO'
    const esNuevoAgregado = item.id < 0 && item.origenCambio != null && cambios[item.origenCambio]?.op === 'agregar'
    const derivado = marca === 'PARTIDO' || (item.id < 0 && !esNuevoAgregado)
    const cantidadCambiada = item.cantidadBase != null && item.cantidad_presentacion !== item.cantidadBase
    const precioCambiado = item.precioBase != null && item.precio_unitario !== item.precioBase
    const cambiado = marca != null && marca !== 'QUITADO'
    const subtotalCambiado = item.subtotalBase != null && Math.abs(item.subtotal - item.subtotalBase) > 0.004
    const precioInfo = item.producto_id != null ? info[item.producto_id] : undefined
    const falta = faltanteDe(item)
    const deshacerQuitar = () => { const i = indiceDeCambio((c) => c.op === 'quitar' && c.item_id === item.id); if (i >= 0) quitarCambio(i) }
    const opAgregar = esNuevoAgregado && item.origenCambio != null ? cambios[item.origenCambio] : null
    return <li key={item.id} className={`ped-fila ${cambiado ? 'ped-fila-cambiada' : ''} ${quitado ? 'ped-fila-quitada' : ''} ${falta ? 'ped-fila-alerta' : ''}`}>
      <div className="ped-fila-info">
        <div className="ped-fila-marcas">{marca && <Chip tone={MARCAS[marca].tono}>{MARCAS[marca].texto}</Chip>}</div>
        <strong>{item.descripcion}</strong>
        {item.presentacion_nombre && <small>{item.presentacion_nombre}</small>}
        {item.cantidad_despachada > 0 && !quitado && <small className="ped-candado"><Lock aria-hidden />Mínimo {cant(item.cantidad_despachada)} u: ya despachadas</small>}
        {item.precio_bloqueado && !quitado && <small className="ped-candado"><Lock aria-hidden />Precio bloqueado: {item.precio_bloqueado_motivo ?? 'requiere autorización.'}</small>}
        {derivado && !quitado && <small className="ped-candado"><Lock aria-hidden />Cantidad y precio se editan desde Partir ítem.</small>}
        {item.cantidad_sin_cubrir > 0 && !quitado && <small className="ped-rojo">{cant(item.cantidad_sin_cubrir)} sin cubrir: no se cobran.</small>}
        {item.id < 0 && item.producto_id != null && precioInfo && !quitado && <PrecioBajoAviso precio={item.precio_unitario} sugerido={precioInfo.sugerido} presentacionNombre={precioInfo.presentacionNombre} factor={precioInfo.factor} baseNombre="u" />}
        {falta && opAgregar?.op === 'agregar' && item.origenCambio != null && <div className="ped-faltante" role="group" aria-label={`Faltante de stock de ${item.descripcion}`}>
          <p><TriangleAlert aria-hidden />Faltan {cant(falta.faltante)} (hay {cant(falta.disponible)} disponibles). Decide qué hacer:</p>
          <div>
            <button type="button" className="ped-btn ped-btn-suave" onClick={() => reemplazarCambio(item.origenCambio!, { ...opAgregar, faltante: 'COMPRAR' })}>Comprar faltante</button>
            {Math.floor(falta.disponible / falta.factor) >= 1 && <button type="button" className="ped-btn ped-btn-suave" onClick={() => reemplazarCambio(item.origenCambio!, { ...opAgregar, cantidad_presentacion: Math.floor(falta.disponible / falta.factor) })}>Bajar a {cant(Math.floor(falta.disponible / falta.factor))}</button>}
            <button type="button" className="ped-btn ped-btn-suave" onClick={() => quitarCambio(item.origenCambio!)}>Cambiar producto</button>
          </div>
        </div>}
        {quitado && <button type="button" className="ped-enlace" onClick={deshacerQuitar}>Deshacer</button>}
      </div>
      <label className={`ped-campo ${cantidadCambiada ? 'ped-campo-cambiado' : ''}`}><span className="ped-campo-etiqueta">Cantidad</span>
        <NumberField ariaLabel={`Cantidad de ${item.descripcion}`} min={item.cantidad_despachada > 0 ? item.cantidad_despachada : 0} step="any" value={item.cantidad_presentacion} disabled={quitado || derivado} onCommit={(valor) => setCantidad(item, valor)} />
      </label>
      <label className={`ped-campo ${precioCambiado ? 'ped-campo-cambiado' : ''}`}><span className="ped-campo-etiqueta">Precio</span>
        <NumberField ariaLabel={`Precio de ${item.descripcion}`} min={0} step={0.01} value={item.precio_unitario} disabled={quitado || derivado || item.precio_bloqueado} onCommit={(valor) => setPrecio(item, valor)} />
      </label>
      <p className="ped-fila-subtotal"><span className="ped-campo-etiqueta">Subtotal</span>
        {subtotalCambiado && <s>{bs(item.subtotalBase!)}</s>}
        <strong>{bs(item.subtotal)}</strong>
      </p>
      <div className="ped-fila-acciones">
        {item.id < 0 && esNuevoAgregado
          ? <button type="button" className="ped-btn ped-btn-icono" aria-label={`Quitar ${item.descripcion} de la edición`} onClick={() => item.origenCambio != null && quitarCambio(item.origenCambio)}><X aria-hidden /></button>
          : item.id < 0
            ? null
            : !quitado && <MenuAcciones
              item={item}
              abierto={menuAbierto === item.id}
              onAlternar={() => setMenuAbierto((actual) => (actual === item.id ? null : item.id))}
              onCerrar={() => setMenuAbierto(null)}
              onPartir={() => setPartir({ itemId: item.id })}
              onCambiarSaldo={() => setSaldo(item.id)}
              onCerrarSaldo={() => agregarCambio({ op: 'cerrar_saldo', item_id: item.id })}
              onSaldoACompra={() => agregarCambio({ op: 'saldo_a_compra', item_id: item.id })}
              onQuitar={() => agregarCambio({ op: 'quitar', item_id: item.id })}
            />}
      </div>
    </li>
  }

  const datos = resultado.datos
  const chips = cambios.flatMap((cambio) => (cambio.op === 'agregar' && cambio.producto_id != null ? [{ productId: cambio.producto_id, nombre: cambio.nombre ?? 'Producto', cantidad: cambio.cantidad_presentacion }] : []))

  return <FeatureShell className="orders-page ped-edicion" eyebrow="PEDIDOS" title={`Editar ${pedido.numero}`} subtitle={`${pedido.cliente_nombre} · versión ${pedido.version}`}>
    <div className="ped-sesion" role="region" aria-label="Sesión de edición">
      <div><strong>Editando {pedido.numero}</strong><small>Basado en la versión {pedido.version} · nada se guarda hasta que confirmes</small></div>
      <div className="ped-sesion-acciones">
        <button type="button" className="ped-btn ped-btn-contorno" onClick={descartar}>Descartar</button>
        <button type="button" className="ped-btn ped-btn-primario" disabled={!puedeRevisar} onClick={() => setConfirmando(true)}>Revisar cambios ({cambios.length})</button>
      </div>
    </div>
    {resultado.errores.length > 0 && <ul className="ped-errores" role="alert">{resultado.errores.map((error, i) => <li key={i}><TriangleAlert aria-hidden />{error.texto}</li>)}</ul>}
    <div className="ped-edicion-grid">
      <div className="ped-edicion-principal">
        <section className="ped-tarjeta" aria-label="Ítems del pedido">
          <ul className="ped-filas">{resultado.items.map(fila)}</ul>
          <div className="ped-agregar">
            <p className="ped-agregar-titulo"><PackagePlus aria-hidden /><strong>Agregar ítem</strong><span>busca un producto o escanea · o <button type="button" className="ped-enlace" onClick={() => setPersonalizado(true)}>ítem personalizado</button></span></p>
            {errorBusqueda && <p className="ped-nota ped-rojo" role="alert">{errorBusqueda}</p>}
            <ProductQuickAdd
              value={consulta}
              onValueChange={setConsulta}
              results={resultados}
              loading={buscando}
              chips={chips}
              priceFor={(producto) => bs(priceForOrderChannel(producto, canal))}
              onAdd={(producto) => void agregarProducto(producto)}
              onRemoveChip={(productId) => { const i = indiceDeCambio((c) => c.op === 'agregar' && c.producto_id === productId); if (i >= 0) quitarCambio(i) }}
            />
          </div>
        </section>
      </div>
      <aside className="ped-lateral" aria-label="Resumen de la edición">
        <section className="ped-tarjeta">
          <h4>Resumen de la edición</h4>
          <dl className="ped-resumen">
            <div><dt>Total actual</dt><dd>{bs(pedido.total)}</dd></div>
            <div className="ped-resumen-nuevo"><dt>Total nuevo</dt><dd>{bs(resultado.totalLocal)}</dd></div>
          </dl>
          <p className="ped-diferencia"><span>Diferencia</span><Chip tone={diferencia < 0 ? 'red' : diferencia > 0 ? 'orange' : 'gray'}>{deltaBs(diferencia)}</Chip></p>
          <h5>{cambios.length} cambio{cambios.length === 1 ? '' : 's'}</h5>
          {cambios.length === 0 ? <p className="ped-nota">Todavía no cambiaste nada.</p> : <ul className="ped-cambios">
            {resumen.map((r) => <li key={r.indice}>
              <span>{r.texto}</span>
              {r.delta !== 0 && <b className={r.delta > 0 ? 'ped-mas' : 'ped-menos'}>{deltaBs(r.delta)}</b>}
              <button type="button" className="ped-enlace" aria-label={`Deshacer: ${r.texto}`} onClick={() => quitarCambio(r.indice)}>Deshacer</button>
            </li>)}
          </ul>}
        </section>
        <section className="ped-tarjeta">
          <h4>Datos del pedido</h4>
          <div className="ped-datos">
            <label className="ped-campo"><span className="ped-campo-etiqueta">Descuento general (Bs)</span>
              <NumberField ariaLabel="Descuento general" min={0} step={0.01} value={datos.descuento_general} onCommit={(valor) => setDatos({ ...datos, descuento_general: valor })} />
            </label>
            <label className="ped-campo"><span className="ped-campo-etiqueta">Condición de pago</span>
              <select value={datos.condicion_pago ?? ''} onChange={(e) => setDatos({ ...datos, condicion_pago: (e.target.value || null) as 'CONTADO' | 'CREDITO' | null })}><option value="">Sin especificar</option><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></select>
            </label>
            <label className="ped-campo"><span className="ped-campo-etiqueta">Referencia</span>
              <input value={datos.referencia ?? ''} onChange={(e) => setDatos({ ...datos, referencia: e.target.value || null })} placeholder="Asunto del pedido" />
            </label>
          </div>
          <div className="ped-cliente">
            <span className="ped-campo-etiqueta">Cliente</span>
            <p className="ped-solo-lectura">{pedido.cliente_nombre}</p>
            {!permisos.puede_cambiar_cliente && <small className="ped-candado"><Lock aria-hidden />El cliente no se puede cambiar: la partida ya tiene pagos. Anula y rehaz el pedido.</small>}
          </div>
        </section>
      </aside>
    </div>
    {itemPartir && partir && <PartirItemModal item={itemPartir} canal={canal} prefill={partir.prefill} onAplicar={aplicar} onClose={() => setPartir(null)} />}
    {itemSaldo && <ProductoSaldoModal item={itemSaldo} canal={canal} onAplicar={aplicar} onClose={() => setSaldo(null)} />}
    {personalizado && <ItemPersonalizadoModal onAplicar={aplicar} onClose={() => setPersonalizado(false)} />}
    {confirmando && <ConfirmarEdicionModal
      base={base}
      cambios={cambios}
      resumen={resumen}
      onClose={() => setConfirmando(false)}
      onRecargar={recargar}
      onGuardado={(guardado) => { setConfirmando(false); limpiar(); onGuardado(guardado) }}
    />}
  </FeatureShell>
}

