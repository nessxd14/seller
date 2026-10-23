import { aplicarCambios, redondear2, resumenCambios, type ErrorLocal, type ItemBorrador } from '../../domain/orders/edicionPedido'
import type {
  AccionAviso, CambioPedido, EventoTiempo, LineaTiempo, PedidoDetalle, PedidoEdicionPort, PrevisualizacionEdicion, ResumenPedido,
} from '../../domain/orders/pedidoEdicion.types'
import { EdicionPedidoError, mapErrorEdicion, type CodigoErrorEdicion } from '../supabase/PedidoEdicion.supabase'
import { mockAuthSessionProvider } from './MockAuthSessionProvider'
import { crearDetalleEscenario, crearTiempoEscenario, PEDIDO_ESCENARIO_ID } from './PedidoEdicion.escenario'

// Réplica en memoria de las RPC de la migración 2026-10-23_pedidos_edicion.sql, para trabajar
// con VITE_POS_MODE=mock. El estado vive mientras la pestaña esté abierta (se reinicia al
// recargar): es un escenario de demostración, no un almacenamiento.

const detalles = new Map<number, PedidoDetalle>([[PEDIDO_ESCENARIO_ID, crearDetalleEscenario()]])
const tiempos = new Map<number, LineaTiempo>([[PEDIDO_ESCENARIO_ID, crearTiempoEscenario()]])
let siguienteId = 9000

const existente = (pedidoId: number): PedidoDetalle => {
  const detalle = detalles.get(pedidoId)
  if (!detalle) throw new Error(`El pedido ${pedidoId} no tiene edición disponible en modo mock.`)
  return detalle
}
const copia = <T,>(valor: T): T => structuredClone(valor)
const actorActual = async (): Promise<string> => {
  const sesion = await mockAuthSessionProvider.getSession()
  return sesion?.user.name ?? sesion?.user.email ?? 'Seller'
}

/** Código que el servidor pondría en `hint` para cada error que detecta el dominio localmente. */
const codigoServidor = (codigo: ErrorLocal['codigo']): CodigoErrorEdicion => (codigo === 'ITEM_NO_ENCONTRADO' ? 'ITEM_INVALIDO' : codigo === 'PRECIO_BLOQUEADO' ? 'PRECIO_REQUIERE_AUTORIZACION' : codigo)

const estadoPago = (pagado: number, total: number): PedidoDetalle['estados']['pago'] => (pagado >= total && total > 0 ? 'PAGADO' : pagado > 0 ? 'PARCIAL' : 'PENDIENTE')

/** Simula que Almacén tocó el pedido mientras el vendedor editaba (para probar VERSION_CAMBIADA). */
export const simularCambioDeAlmacen = (pedidoId: number): void => {
  const detalle = existente(pedidoId)
  const antes = detalle.pedido.version
  detalle.pedido.version += 1
  const linea = tiempos.get(pedidoId)
  linea?.eventos.unshift({
    id: siguienteId++, sesion_id: null, actor: 'Rovin', actor_rol: 'ALMACEN', tipo: 'LINEA_ALISTADA', titulo: 'alistó el pedido para despacho',
    cambios: [{ texto: 'Fastener: 15 paquetes alistados' }], delta_total: 0, total_antes: detalle.pedido.total, total_despues: detalle.pedido.total,
    version_antes: antes, version_despues: detalle.pedido.version, motivo: null, creado_en: new Date().toISOString(),
  })
  linea?.versiones.unshift({ version: detalle.pedido.version, etiqueta: 'Alistado por almacén', total: detalle.pedido.total, creado_en: new Date().toISOString() })
}

export const pedidoEdicionMock: PedidoEdicionPort = {
  async detalle(pedidoId) { return copia(existente(pedidoId)) },

  async previsualizar(pedidoId, versionEsperada, cambios): Promise<PrevisualizacionEdicion> {
    const detalle = existente(pedidoId)
    const resultado = aplicarCambios(detalle, cambios)
    const almacen: PrevisualizacionEdicion['almacen'] = []
    const advertencias: PrevisualizacionEdicion['advertencias'] = []
    let anterior = aplicarCambios(detalle, [])
    cambios.forEach((cambio, indice) => {
      const siguiente = aplicarCambios(detalle, cambios.slice(0, indice + 1))
      const itemAntes = (id: number): ItemBorrador | undefined => anterior.items.find((item) => item.id === id)
      if (siguiente.errores.some((error) => error.indice === indice)) { anterior = siguiente; return }
      switch (cambio.op) {
        case 'agregar': almacen.push({ accion: 'LINEA_NUEVA', texto: `Línea nueva: ${cambio.descripcion ?? cambio.nombre ?? 'Producto'} × ${cambio.cantidad_presentacion}${(cambio.cantidad_compra ?? 0) > 0 ? ` (${cambio.cantidad_compra} a compra)` : ''}` }); break
        case 'cantidad': {
          const antes = itemAntes(cambio.item_id)
          if (!antes) break
          const diferencia = cambio.cantidad_presentacion - antes.cantidad_presentacion
          if (diferencia > 0) almacen.push({ accion: 'LINEA_NUEVA', texto: `${antes.descripcion}: ${diferencia} u más por surtir` })
          else if (diferencia < 0) {
            almacen.push({ accion: 'LINEA_CANCELADA', texto: `${antes.descripcion}: se cancelan ${-diferencia} u pendientes` })
            if (antes.lineas.some((linea) => linea.alistada && linea.estado !== 'DESPACHADA')) advertencias.push({ codigo: 'LINEA_ALISTADA', texto: `${antes.descripcion} tiene unidades ya alistadas: almacén tendrá que devolverlas a su lugar.` })
          }
          break
        }
        case 'precio': break
        case 'partir': break
        case 'cambiar_producto_saldo': almacen.push({ accion: 'LINEA_NUEVA', texto: `Línea nueva para el saldo de ${itemAntes(cambio.item_id)?.descripcion ?? 'ítem'}: ${cambio.nombre ?? 'otro producto'}` }); break
        case 'cerrar_saldo': almacen.push({ accion: 'LINEA_REDUCIDA', texto: `${itemAntes(cambio.item_id)?.descripcion ?? 'Ítem'}: se cancela lo pendiente de surtir` }); break
        case 'quitar': {
          const antes = itemAntes(cambio.item_id)
          almacen.push({ accion: 'LINEA_CANCELADA', texto: `${antes?.descripcion ?? 'Ítem'}: se cancelan sus líneas de surtido` })
          break
        }
        case 'saldo_a_compra': almacen.push({ accion: 'LINEA_NUEVA', texto: `${itemAntes(cambio.item_id)?.descripcion ?? 'Ítem'}: el saldo pasa a compra` }); break
        case 'datos': break
      }
      anterior = siguiente
    })
    const total = resultado.totalLocal
    return {
      total_anterior: detalle.pedido.total,
      total_nuevo: total,
      delta: redondear2(total - detalle.pedido.total),
      cuenta: {
        tiene_cuenta: detalle.cuenta.tiene_cuenta ?? true,
        partida_antes: detalle.cuenta.partida_total,
        partida_despues: total,
        pagado: detalle.cuenta.pagado,
        saldo_antes: detalle.cuenta.saldo,
        saldo_despues: Math.max(0, redondear2(total - detalle.cuenta.pagado)),
        saldo_a_favor: 0,
      },
      almacen,
      advertencias,
      errores: [
        ...(versionEsperada !== detalle.pedido.version ? [{ codigo: 'VERSION_CAMBIADA', item_id: null, texto: mapErrorEdicion('VERSION_CAMBIADA') }] : []),
        ...resultado.errores.map((error) => ({ codigo: codigoServidor(error.codigo), item_id: error.item_id, texto: error.texto })),
        ...(total < detalle.cuenta.pagado - 1e-9 ? [{ codigo: 'REDUCCION_BAJO_PAGADO', item_id: null, texto: mapErrorEdicion('REDUCCION_BAJO_PAGADO') }] : []),
      ],
      ok: versionEsperada === detalle.pedido.version && resultado.errores.length === 0 && total >= detalle.cuenta.pagado - 1e-9,
      version: detalle.pedido.version,
    }
  },

  async editar(pedidoId, versionEsperada, cambios, motivo) {
    const detalle = existente(pedidoId)
    if (!detalle.permisos.puede_editar) throw new EdicionPedidoError('SIN_PERMISO', mapErrorEdicion('SIN_PERMISO'))
    if (detalle.estados.comercial !== 'ABIERTO') throw new EdicionPedidoError('PEDIDO_NO_EDITABLE', mapErrorEdicion('PEDIDO_NO_EDITABLE'))
    if (!motivo.trim()) throw new EdicionPedidoError('MOTIVO_REQUERIDO', mapErrorEdicion('MOTIVO_REQUERIDO'))
    if (versionEsperada !== detalle.pedido.version) throw new EdicionPedidoError('VERSION_CAMBIADA', mapErrorEdicion('VERSION_CAMBIADA'))
    const resultado = aplicarCambios(detalle, cambios)
    const primerError = resultado.errores[0]
    if (primerError) {
      throw new EdicionPedidoError(codigoServidor(primerError.codigo), primerError.texto)
    }
    if (resultado.totalLocal < detalle.cuenta.pagado - 1e-9) throw new EdicionPedidoError('REDUCCION_BAJO_PAGADO', mapErrorEdicion('REDUCCION_BAJO_PAGADO'))
    const resumen = resumenCambios(cambios, detalle)
    const cerrados = new Set(avisosQueSeCierran(detalle, resultado.items, cambios).map((aviso) => aviso.id))
    const itemsFinales = resultado.items.map(({ subtotalBase, cantidadBase, precioBase, ...item }) => {
      void subtotalBase; void cantidadBase; void precioBase
      const id = item.id < 0 ? siguienteId++ : item.id
      return { ...item, id, lineas: item.lineas.map((linea) => ({ ...linea, id: linea.id < 0 ? siguienteId++ : linea.id })) }
    })
    // Los ítems nuevos nacidos de otro (partir / cambiar saldo) apuntan al id definitivo de su origen.
    const idsTemporales = new Map<number, number>()
    resultado.items.forEach((item, indice) => idsTemporales.set(item.id, itemsFinales[indice].id))
    for (const item of itemsFinales) if (item.origen_item_id != null) item.origen_item_id = idsTemporales.get(item.origen_item_id) ?? item.origen_item_id

    const totalAntes = detalle.pedido.total
    const totalDespues = resultado.totalLocal
    const versionAntes = detalle.pedido.version
    detalle.items = itemsFinales
    detalle.avisos = detalle.avisos.filter((aviso) => !cerrados.has(aviso.id))
    detalle.pedido.version = versionAntes + 1
    detalle.pedido.total = totalDespues
    detalle.pedido.descuento_general = resultado.datos.descuento_general
    detalle.pedido.condicion_pago = resultado.datos.condicion_pago
    detalle.pedido.medio_pago = resultado.datos.medio_pago
    detalle.pedido.referencia = resultado.datos.referencia
    const lineas = detalle.items.flatMap((item) => (item.estado === 'QUITADO' ? [] : item.lineas))
    detalle.estados.lineas_total = lineas.length
    detalle.estados.lineas_despachadas = lineas.filter((linea) => linea.estado === 'DESPACHADA').length
    detalle.estados.pago = estadoPago(detalle.cuenta.pagado, totalDespues)
    detalle.cuenta = { ...detalle.cuenta, tiene_cuenta: true, partida_total: totalDespues, saldo: Math.max(0, redondear2(totalDespues - detalle.cuenta.pagado)), sincronizada: true }

    const linea = tiempos.get(pedidoId) ?? { eventos: [], comentarios: [], versiones: [] }
    tiempos.set(pedidoId, linea)
    const ahora = new Date().toISOString()
    const sesion = siguienteId++
    const evento: EventoTiempo = {
      id: siguienteId++, sesion_id: sesion, actor: await actorActual(), actor_rol: 'SELLER', tipo: 'EDICION', titulo: 'editó el pedido',
      cambios: resumen.map((r) => ({ texto: r.delta !== 0 ? `${r.texto} (${r.delta > 0 ? '+' : '−'}Bs ${Math.abs(r.delta).toFixed(2)})` : r.texto })),
      delta_total: redondear2(totalDespues - totalAntes), total_antes: totalAntes, total_despues: totalDespues,
      version_antes: versionAntes, version_despues: versionAntes + 1, motivo: motivo.trim(), creado_en: ahora,
    }
    linea.eventos.unshift(evento)
    linea.versiones.unshift({ version: versionAntes + 1, etiqueta: 'Edición del vendedor', total: totalDespues, creado_en: ahora })
    return { ok: true, version: versionAntes + 1, total_anterior: totalAntes, total_nuevo: totalDespues, delta: redondear2(totalDespues - totalAntes) }
  },

  async resolverAviso(avisoId: number, accion: AccionAviso) {
    const detalle = Array.from(detalles.values()).find((candidato) => candidato.avisos.some((aviso) => aviso.id === avisoId))
    const aviso = detalle?.avisos.find((candidato) => candidato.id === avisoId)
    if (!detalle || !aviso) throw new EdicionPedidoError('AVISO_RESUELTO', mapErrorEdicion('AVISO_RESUELTO'))
    if (aviso.tipo !== 'SUSTITUCION') throw new EdicionPedidoError('ACCION_INVALIDA', mapErrorEdicion('ACCION_INVALIDA'))
    const linea = tiempos.get(detalle.pedido.id)
    const antes = detalle.pedido.version
    if (accion === 'RECHAZAR_SUSTITUTO') {
      const item = detalle.items.find((candidato) => candidato.id === aviso.item_id)
      const sustituto = item?.lineas.find((l) => l.id === aviso.linea_id)
      if (!item || !sustituto || sustituto.estado === 'DESPACHADA') throw new EdicionPedidoError('SUSTITUTO_DESPACHADO', mapErrorEdicion('SUSTITUTO_DESPACHADO'))
      item.lineas = item.lineas.filter((l) => l.id !== sustituto.id)
      item.lineas.push({ ...sustituto, id: siguienteId++, estado: 'SIN_CUBRIR', tipo_surtido: 'ORIGINAL', descripcion: item.descripcion })
      item.cantidad_sin_cubrir += sustituto.cantidad_presentacion
    }
    detalle.avisos = detalle.avisos.filter((candidato) => candidato.id !== avisoId)
    detalle.pedido.version = antes + 1
    const titulo = accion === 'MANTENER_PRECIO' ? 'mantuvo el precio del ítem con el sustituto' : 'rechazó el sustituto'
    linea?.eventos.unshift({ id: siguienteId++, sesion_id: null, actor: await actorActual(), actor_rol: 'SELLER', tipo: 'AVISO_RESUELTO', titulo, cambios: [{ texto: aviso.texto }], delta_total: 0, total_antes: detalle.pedido.total, total_despues: detalle.pedido.total, version_antes: antes, version_despues: antes + 1, motivo: null, creado_en: new Date().toISOString() })
    linea?.versiones.unshift({ version: antes + 1, etiqueta: 'Aviso resuelto', total: detalle.pedido.total, creado_en: new Date().toISOString() })
  },

  async lineaTiempo(pedidoId) { return copia(tiempos.get(pedidoId) ?? { eventos: [], comentarios: [], versiones: [] }) },

  async comentar(pedidoId, texto) {
    const linea = tiempos.get(pedidoId)
    if (!linea) return
    linea.comentarios.unshift({ id: siguienteId++, autor: await actorActual(), texto: texto.trim(), creado_en: new Date().toISOString() })
  },

  async resumenPedidos(ids): Promise<ResumenPedido[]> {
    return ids.flatMap((id) => {
      const detalle = detalles.get(id)
      if (!detalle) return []
      const tipos = Array.from(new Set(detalle.avisos.map((aviso) => aviso.tipo)))
      const edicion = tiempos.get(id)?.eventos.find((evento) => evento.actor_rol === 'SELLER' && evento.tipo === 'EDICION')
      return [{ pedido_id: id, version: detalle.pedido.version, estado_surtido: detalle.estados.surtido, avisos: tipos, editado_en: edicion?.creado_en ?? null }]
    })
  },
}

/** Avisos que la edición deja sin objeto: el ítem se partió, se quitó o ya no tiene saldo sin cubrir. */
function avisosQueSeCierran(detalle: PedidoDetalle, items: ItemBorrador[], cambios: CambioPedido[]) {
  return detalle.avisos.filter((aviso) => {
    const item = items.find((candidato) => candidato.id === aviso.item_id)
    if (!item || item.estado === 'QUITADO') return true
    if (aviso.tipo === 'SUSTITUCION') return cambios.some((cambio) => cambio.op === 'partir' && cambio.item_id === aviso.item_id)
    return item.cantidad_sin_cubrir === 0
  })
}
