// Brief "Seller: edición de pedido" T2 — lógica pura de la sesión de edición. Sin React ni
// I/O. Replica las reglas del servidor SOLO para dar feedback instantáneo mientras el
// vendedor arma la edición; la previsualización del servidor (previsualizar_edicion_pedido)
// sigue siendo la verdad. Regla de fondo: Almacén decide qué sale físicamente, el Seller
// decide cuánto cuesta — el dinero vive en el ítem comercial, nunca en la línea de surtido.
import type { CambioPedido, ParteItem, PedidoDetalle, PedidoItem, PedidoLineaSurtido } from './pedidoEdicion.types'

export type MarcaItem = 'NUEVO' | 'MODIFICADO' | 'PARTIDO' | 'QUITADO'

export interface ItemBorrador extends PedidoItem {
  /** Subtotal de la versión base; null si el ítem nació en esta edición. */
  subtotalBase: number | null
  cantidadBase: number | null
  precioBase: number | null
  /** Posición del cambio que creó este ítem (agregar / partir / cambiar saldo); null si viene del servidor. */
  origenCambio: number | null
}

export interface ErrorLocal {
  codigo: 'ITEM_NO_ENCONTRADO' | 'CANTIDAD_BAJO_DESPACHADO' | 'ITEM_CON_DESPACHO' | 'PARTIR_NO_CUADRA' | 'PRECIO_BLOQUEADO' | 'SIN_SALDO' | 'SIN_FALTANTE' | 'CANTIDAD_INVALIDA'
  item_id: number | null
  /** Posición del cambio que lo originó dentro de la lista de cambios. */
  indice: number
  texto: string
}

export interface DatosBorrador {
  descuento_general: number
  condicion_pago: 'CONTADO' | 'CREDITO' | null
  medio_pago: string | null
  referencia: string | null
}

export interface ResultadoAplicacion {
  items: ItemBorrador[]
  totalLocal: number
  porItem: Map<number, MarcaItem>
  errores: ErrorLocal[]
  datos: DatosBorrador
}

export const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

// Lo "sin cubrir" SIGUE cobrándose hasta que el Seller decida (addendum §3): nunca se descuenta solo.
const subtotalDe = (item: Pick<PedidoItem, 'cantidad_presentacion' | 'precio_unitario' | 'descuento_pct' | 'estado'>): number =>
  item.estado === 'QUITADO' ? 0 : redondear2(item.cantidad_presentacion * item.precio_unitario * (1 - item.descuento_pct / 100))

const enBorrador = (item: PedidoItem): ItemBorrador => ({
  ...item,
  lineas: item.lineas.map((linea) => ({ ...linea })),
  subtotalBase: item.subtotal,
  cantidadBase: item.cantidad_presentacion,
  precioBase: item.precio_unitario,
  origenCambio: null,
})

const qty = (n: number): string => String(redondear2(n))
const bs = (n: number): string => redondear2(n).toFixed(2)

/**
 * Aplica `cambios` (en orden) sobre el detalle `base`. Un cambio que no aplica se descarta
 * y queda en `errores`; los demás siguen aplicándose. Los ítems nuevos reciben ids negativos
 * (temporales) para poder referenciarlos dentro de la misma sesión.
 */
export const aplicarCambios = (base: PedidoDetalle, cambios: CambioPedido[]): ResultadoAplicacion => {
  let items: ItemBorrador[] = base.items.map(enBorrador)
  const errores: ErrorLocal[] = []
  const tocados = new Map<number, MarcaItem>()
  let siguienteTemporal = -1
  let indiceActual = 0
  let datos: DatosBorrador = {
    descuento_general: base.pedido.descuento_general,
    condicion_pago: base.pedido.condicion_pago,
    medio_pago: base.pedido.medio_pago,
    referencia: base.pedido.referencia,
  }

  const marcar = (id: number, marca: MarcaItem) => {
    const previa = tocados.get(id)
    const prioridad: MarcaItem[] = ['MODIFICADO', 'QUITADO', 'PARTIDO', 'NUEVO']
    if (!previa || prioridad.indexOf(marca) > prioridad.indexOf(previa)) tocados.set(id, marca)
  }
  const recalcular = (item: ItemBorrador) => { item.subtotal = subtotalDe(item) }
  const falla = (indice: number, codigo: ErrorLocal['codigo'], itemId: number | null, texto: string) => { errores.push({ codigo, item_id: itemId, indice, texto }) }
  const buscar = (indice: number, itemId: number): ItemBorrador | null => {
    const item = items.find((candidato) => candidato.id === itemId && candidato.estado === 'VIGENTE')
    if (!item) falla(indice, 'ITEM_NO_ENCONTRADO', itemId, 'El ítem ya no está en el pedido.')
    return item ?? null
  }
  const nuevoItem = (parcial: Pick<ItemBorrador, 'producto_id' | 'presentacion_id' | 'presentacion_nombre' | 'descripcion' | 'es_personalizado' | 'unidad_medida' | 'cantidad_presentacion' | 'precio_unitario' | 'descuento_pct' | 'origen_item_id'> & { lineas: PedidoLineaSurtido[]; cantidad_despachada?: number }): ItemBorrador => {
    const item: ItemBorrador = {
      id: siguienteTemporal--,
      cantidad_despachada: 0,
      cantidad_sin_cubrir: 0,
      subtotal: 0,
      estado: 'VIGENTE',
      precio_bloqueado: false,
      precio_bloqueado_motivo: null,
      subtotalBase: null,
      cantidadBase: null,
      precioBase: null,
      origenCambio: indiceActual,
      ...parcial,
    }
    recalcular(item)
    marcar(item.id, 'NUEVO')
    return item
  }

  cambios.forEach((cambio, indice) => {
    indiceActual = indice
    switch (cambio.op) {
      case 'agregar': {
        if (!(cambio.cantidad_presentacion > 0)) { falla(indice, 'CANTIDAD_INVALIDA', null, 'La cantidad debe ser mayor a cero.'); return }
        const nombre = cambio.descripcion ?? cambio.nombre ?? 'Producto'
        const compra = Math.min(Math.max(cambio.cantidad_compra ?? 0, 0), cambio.cantidad_presentacion)
        const lineasNuevas: PedidoLineaSurtido[] = []
        if (cambio.cantidad_presentacion - compra > 0) lineasNuevas.push({ id: siguienteTemporal--, descripcion: nombre, cantidad_presentacion: cambio.cantidad_presentacion - compra, estado: 'POR_DESPACHAR', tipo_surtido: 'ORIGINAL', ubicacion: null, alistada: false, nota: null })
        if (compra > 0) lineasNuevas.push({ id: siguienteTemporal--, descripcion: nombre, cantidad_presentacion: compra, estado: 'POR_COMPRAR', tipo_surtido: 'COMPRA', ubicacion: null, alistada: false, nota: null })
        items.push(nuevoItem({
          producto_id: cambio.producto_id,
          presentacion_id: cambio.presentacion_id,
          presentacion_nombre: cambio.presentacion_nombre ?? null,
          descripcion: nombre,
          es_personalizado: cambio.es_personalizado,
          unidad_medida: cambio.unidad_medida,
          cantidad_presentacion: cambio.cantidad_presentacion,
          precio_unitario: cambio.precio_unitario,
          descuento_pct: cambio.descuento_pct,
          origen_item_id: null,
          lineas: lineasNuevas,
        }))
        return
      }
      case 'cantidad': {
        const item = buscar(indice, cambio.item_id)
        if (!item) return
        if (!(cambio.cantidad_presentacion > 0)) { falla(indice, 'CANTIDAD_INVALIDA', item.id, 'La cantidad debe ser mayor a cero.'); return }
        if (cambio.cantidad_presentacion < item.cantidad_despachada) { falla(indice, 'CANTIDAD_BAJO_DESPACHADO', item.id, `No puedes bajar de lo ya despachado (${qty(item.cantidad_despachada)}).`); return }
        item.cantidad_presentacion = cambio.cantidad_presentacion
        item.cantidad_sin_cubrir = Math.min(item.cantidad_sin_cubrir, item.cantidad_presentacion)
        recalcular(item)
        marcar(item.id, 'MODIFICADO')
        return
      }
      case 'precio': {
        const item = buscar(indice, cambio.item_id)
        if (!item) return
        if (item.precio_bloqueado) { falla(indice, 'PRECIO_BLOQUEADO', item.id, item.precio_bloqueado_motivo ?? 'El precio de este ítem está bloqueado.'); return }
        item.precio_unitario = cambio.precio_unitario
        item.descuento_pct = cambio.descuento_pct
        recalcular(item)
        marcar(item.id, 'MODIFICADO')
        return
      }
      case 'partir': {
        const item = buscar(indice, cambio.item_id)
        if (!item) return
        const { partes } = cambio
        const suma = partes.reduce((total, parte) => total + parte.cantidad_presentacion, 0)
        if (partes.length < 2 || Math.abs(suma - item.cantidad_presentacion) > 1e-9) { falla(indice, 'PARTIR_NO_CUADRA', item.id, 'Las partes no suman la cantidad del ítem.'); return }
        if (partes[0].cantidad_presentacion < item.cantidad_despachada) { falla(indice, 'CANTIDAD_BAJO_DESPACHADO', item.id, `La primera parte conserva lo despachado (mínimo ${qty(item.cantidad_despachada)}).`); return }
        const reclamadas = new Set(partes.slice(1).flatMap((parte: ParteItem) => parte.linea_ids))
        const lineasOriginales = item.lineas
        const sinCubrirOriginal = item.cantidad_sin_cubrir
        const despachadaOriginal = item.cantidad_despachada
        // La primera parte conserva el ítem (id, despachos) y las líneas que nadie más reclama.
        const nuevas: ItemBorrador[] = partes.slice(1).map((parte) => {
          const lineas = lineasOriginales.filter((linea) => parte.linea_ids.includes(linea.id))
          const despachada = lineas.filter((linea) => linea.estado === 'DESPACHADA').reduce((total, linea) => total + linea.cantidad_presentacion, 0)
          const creada = nuevoItem({
            producto_id: parte.producto_id,
            presentacion_id: parte.presentacion_id,
            presentacion_nombre: null,
            descripcion: parte.nombre ?? item.descripcion,
            es_personalizado: false,
            unidad_medida: item.unidad_medida,
            cantidad_presentacion: parte.cantidad_presentacion,
            precio_unitario: parte.precio_unitario,
            descuento_pct: 0,
            origen_item_id: item.id,
            lineas,
            cantidad_despachada: despachada,
          })
          tocados.set(creada.id, 'PARTIDO')
          return creada
        })
        const primera = partes[0]
        item.lineas = lineasOriginales.filter((linea) => !reclamadas.has(linea.id))
        item.cantidad_despachada = Math.max(0, despachadaOriginal - nuevas.reduce((total, nueva) => total + nueva.cantidad_despachada, 0))
        item.cantidad_presentacion = primera.cantidad_presentacion
        item.cantidad_sin_cubrir = Math.min(sinCubrirOriginal, primera.cantidad_presentacion)
        item.precio_unitario = primera.precio_unitario
        recalcular(item)
        marcar(item.id, 'PARTIDO')
        const posicion = items.indexOf(item)
        items.splice(posicion + 1, 0, ...nuevas)
        return
      }
      case 'cambiar_producto_saldo': {
        const item = buscar(indice, cambio.item_id)
        if (!item) return
        // Igual que el servidor: lo ya despachado se queda; TODO el resto pasa al producto nuevo.
        const saldo = item.cantidad_presentacion - item.cantidad_despachada
        if (saldo <= 1e-4) { falla(indice, 'SIN_SALDO', item.id, 'Ese ítem ya no tiene saldo por entregar.'); return }
        item.cantidad_presentacion = item.cantidad_despachada
        item.cantidad_sin_cubrir = 0
        item.lineas = item.lineas.filter((linea) => linea.estado === 'DESPACHADA')
        if (item.cantidad_presentacion <= 1e-4) item.estado = 'QUITADO'
        recalcular(item)
        marcar(item.id, item.estado === 'QUITADO' ? 'QUITADO' : 'MODIFICADO')
        const nombre = cambio.nombre ?? 'Producto'
        const compra = Math.min(Math.max(cambio.cantidad_compra ?? 0, 0), saldo)
        const lineasNuevas: PedidoLineaSurtido[] = []
        if (saldo - compra > 0) lineasNuevas.push({ id: siguienteTemporal--, descripcion: nombre, cantidad_presentacion: saldo - compra, estado: 'POR_DESPACHAR', tipo_surtido: 'SUSTITUTO', ubicacion: null, alistada: false, nota: null })
        if (compra > 0) lineasNuevas.push({ id: siguienteTemporal--, descripcion: nombre, cantidad_presentacion: compra, estado: 'POR_COMPRAR', tipo_surtido: 'COMPRA', ubicacion: null, alistada: false, nota: null })
        const creado = nuevoItem({
          producto_id: cambio.producto_id,
          presentacion_id: cambio.presentacion_id,
          presentacion_nombre: null,
          descripcion: nombre,
          es_personalizado: false,
          unidad_medida: null,
          cantidad_presentacion: saldo,
          precio_unitario: cambio.precio_unitario,
          descuento_pct: 0,
          origen_item_id: item.id,
          lineas: lineasNuevas,
        })
        items.splice(items.indexOf(item) + 1, 0, creado)
        return
      }
      case 'cerrar_saldo': {
        // "Cobrar solo lo entregado": la cantidad baja a lo despachado; sin despachos, el servidor quita el ítem.
        const item = buscar(indice, cambio.item_id)
        if (!item) return
        item.cantidad_presentacion = item.cantidad_despachada
        item.cantidad_sin_cubrir = 0
        item.lineas = item.lineas.filter((linea) => linea.estado === 'DESPACHADA')
        if (item.cantidad_presentacion <= 1e-4) item.estado = 'QUITADO'
        recalcular(item)
        marcar(item.id, item.estado === 'QUITADO' ? 'QUITADO' : 'MODIFICADO')
        return
      }
      case 'quitar': {
        const item = buscar(indice, cambio.item_id)
        if (!item) return
        if (item.cantidad_despachada > 0) { falla(indice, 'ITEM_CON_DESPACHO', item.id, 'Ese ítem ya tiene unidades despachadas: usa Cerrar saldo.'); return }
        if (item.id < 0) { items = items.filter((candidato) => candidato.id !== item.id); tocados.delete(item.id); return }
        item.estado = 'QUITADO'
        recalcular(item)
        marcar(item.id, 'QUITADO')
        return
      }
      case 'saldo_a_compra': {
        // Solo cambia dónde se surte lo que falta: el dinero no se mueve.
        const item = buscar(indice, cambio.item_id)
        if (!item) return
        if (item.cantidad_sin_cubrir <= 0) { falla(indice, 'SIN_FALTANTE', item.id, 'Ese ítem no tiene cantidad sin cubrir.'); return }
        const saldo = item.cantidad_sin_cubrir
        item.cantidad_sin_cubrir = 0
        const sinCubrir = item.lineas.find((linea) => linea.estado === 'SIN_CUBRIR')
        if (sinCubrir) { sinCubrir.estado = 'POR_COMPRAR'; sinCubrir.tipo_surtido = 'COMPRA' }
        else item.lineas.push({ id: siguienteTemporal--, descripcion: item.descripcion, cantidad_presentacion: saldo, estado: 'POR_COMPRAR', tipo_surtido: 'COMPRA', ubicacion: null, alistada: false, nota: null })
        marcar(item.id, 'MODIFICADO')
        return
      }
      case 'datos': {
        datos = {
          descuento_general: cambio.descuento_general ?? datos.descuento_general,
          condicion_pago: cambio.condicion_pago !== undefined ? cambio.condicion_pago : datos.condicion_pago,
          medio_pago: cambio.medio_pago !== undefined ? cambio.medio_pago : datos.medio_pago,
          referencia: cambio.referencia !== undefined ? cambio.referencia : datos.referencia,
        }
        return
      }
    }
  })

  const suma = (lista: Array<{ estado: PedidoItem['estado']; subtotal: number }>) => lista.reduce((total, item) => total + (item.estado === 'QUITADO' ? 0 : item.subtotal), 0)
  const sumaBase = suma(base.items)
  // Delta sobre el total del servidor: si la base ya traía desfasajes (líneas con precio 0), no se "arreglan" a escondidas.
  const totalLocal = redondear2(base.pedido.total + (suma(items) - sumaBase) - (datos.descuento_general - base.pedido.descuento_general))
  return { items, totalLocal, porItem: tocados, errores, datos }
}

export interface ResumenCambio { indice: number; texto: string; delta: number }

/** Una entrada por cambio, con el efecto de cada uno sobre el total (para el panel lateral). */
export const resumenCambios = (cambios: CambioPedido[], base: PedidoDetalle): ResumenCambio[] => {
  const resultado: ResumenCambio[] = []
  let anterior = aplicarCambios(base, [])
  cambios.forEach((cambio, indice) => {
    const siguiente = aplicarCambios(base, cambios.slice(0, indice + 1))
    const nombreDe = (id: number): string => anterior.items.find((item) => item.id === id)?.descripcion ?? 'ítem'
    const itemAntes = (id: number): ItemBorrador | undefined => anterior.items.find((item) => item.id === id)
    let texto: string
    switch (cambio.op) {
      case 'agregar': texto = `Agregar ${cambio.descripcion ?? cambio.nombre ?? 'Producto'} × ${qty(cambio.cantidad_presentacion)}`; break
      case 'cantidad': texto = `${nombreDe(cambio.item_id)}: cantidad ${qty(itemAntes(cambio.item_id)?.cantidad_presentacion ?? 0)} → ${qty(cambio.cantidad_presentacion)}`; break
      case 'precio': texto = `${nombreDe(cambio.item_id)}: precio Bs ${bs(itemAntes(cambio.item_id)?.precio_unitario ?? 0)} → Bs ${bs(cambio.precio_unitario)}`; break
      case 'partir': texto = `Partir ${nombreDe(cambio.item_id)} en ${cambio.partes.length} partes`; break
      case 'cambiar_producto_saldo': texto = `Saldo de ${nombreDe(cambio.item_id)}: cambiar por ${cambio.nombre ?? 'otro producto'}`; break
      case 'cerrar_saldo': texto = `Cerrar saldo de ${nombreDe(cambio.item_id)}`; break
      case 'quitar': texto = `Quitar ${nombreDe(cambio.item_id)}`; break
      case 'saldo_a_compra': texto = `Mandar a compra el saldo de ${nombreDe(cambio.item_id)}`; break
      case 'datos': texto = 'Datos del pedido actualizados'; break
    }
    resultado.push({ indice, texto, delta: redondear2(siguiente.totalLocal - anterior.totalLocal) })
    anterior = siguiente
  })
  return resultado
}

const sinVacios = <T extends Record<string, unknown>>(objeto: T): Partial<T> =>
  Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined)) as Partial<T>

/**
 * Forma exacta que espera `editar_pedido` (addendum §4): quita los campos solo-de-interfaz,
 * manda `cantidad_compra` (número) y deja la parte 0 de un `partir` sin producto ni líneas
 * (siempre es el producto original; lo que no se lista se queda con ella). `datos` ya viene
 * con solo las llaves que cambiaron (el servidor toca únicamente las que recibe).
 */
export const cambiosParaServidor = (cambios: CambioPedido[]): unknown[] =>
  cambios.map((cambio) => {
    switch (cambio.op) {
      case 'agregar': { const { nombre, presentacion_nombre, ...resto } = cambio; void nombre; void presentacion_nombre; return sinVacios({ ...resto, cantidad_compra: resto.cantidad_compra ?? 0 }) }
      case 'cantidad': return sinVacios({ ...cambio, cantidad_compra: cambio.cantidad_compra ?? 0 })
      case 'cambiar_producto_saldo': { const { nombre, ...resto } = cambio; void nombre; return sinVacios({ ...resto, cantidad_compra: resto.cantidad_compra ?? 0 }) }
      case 'partir':
        return {
          op: 'partir',
          item_id: cambio.item_id,
          partes: cambio.partes.map(({ nombre, ...parte }, indice) => {
            void nombre
            if (indice === 0) return { cantidad_presentacion: parte.cantidad_presentacion, precio_unitario: parte.precio_unitario }
            return sinVacios({ producto_id: parte.producto_id, presentacion_id: parte.presentacion_id, cantidad_presentacion: parte.cantidad_presentacion, precio_unitario: parte.precio_unitario, linea_ids: parte.linea_ids })
          }),
        }
      default: return cambio
    }
  })

/**
 * Reaplica una lista de cambios sobre una base nueva (tras VERSION_CAMBIADA). Devuelve los
 * que siguen aplicando y los que ya no, con su motivo.
 */
export const reaplicarCambios = (base: PedidoDetalle, cambios: CambioPedido[]): { vigentes: CambioPedido[]; descartados: Array<{ cambio: CambioPedido; texto: string }> } => {
  const vigentes: CambioPedido[] = []
  const descartados: Array<{ cambio: CambioPedido; texto: string }> = []
  for (const cambio of cambios) {
    const prueba = [...vigentes, cambio]
    const { errores } = aplicarCambios(base, prueba)
    const nuevoError = errores.find((error) => error.indice === prueba.length - 1)
    if (nuevoError) descartados.push({ cambio, texto: nuevoError.texto })
    else vigentes.push(cambio)
  }
  return { vigentes, descartados }
}
