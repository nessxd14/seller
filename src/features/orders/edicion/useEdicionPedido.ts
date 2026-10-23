import { useCallback, useEffect, useMemo, useState } from 'react'
import { aplicarCambios, reaplicarCambios, resumenCambios, type ItemBorrador, type ResultadoAplicacion, type ResumenCambio } from '../../../domain/orders/edicionPedido'
import type { CambioPedido, PedidoDetalle } from '../../../domain/orders/pedidoEdicion.types'
import { pedidoEdicionService } from '../../../infrastructure/services'

type DatosCambio = Extract<CambioPedido, { op: 'datos' }>

const itemDe = (cambio: CambioPedido): number | null => ('item_id' in cambio ? cambio.item_id : null)

/**
 * Estado de la sesión de edición: el detalle base (versión sobre la que se edita) más la lista
 * de cambios en borrador. Todo lo que se ve sale de `aplicarCambios`; nada se guarda hasta
 * confirmar (ConfirmarEdicionModal).
 */
export function useEdicionPedido(pedidoId: number) {
  const [base, setBase] = useState<PedidoDetalle | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando')
  const [cambios, setCambios] = useState<CambioPedido[]>([])

  useEffect(() => {
    let cancelado = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial al abrir la sesión (y al cambiar de pedido)
    setEstado('cargando')
    setCambios([])
    pedidoEdicionService.detalle(pedidoId)
      .then((detalle) => { if (!cancelado) { setBase(detalle); setEstado('listo') } })
      .catch(() => { if (!cancelado) setEstado('error') })
    return () => { cancelado = true }
  }, [pedidoId])

  const resultado = useMemo<ResultadoAplicacion | null>(() => (base ? aplicarCambios(base, cambios) : null), [base, cambios])
  const resumen = useMemo<ResumenCambio[]>(() => (base ? resumenCambios(cambios, base) : []), [base, cambios])

  const agregarCambio = useCallback((cambio: CambioPedido) => setCambios((actuales) => [...actuales, cambio]), [])
  const quitarCambio = useCallback((indice: number) => setCambios((actuales) => actuales.filter((_, i) => i !== indice)), [])
  const reemplazarCambio = useCallback((indice: number, cambio: CambioPedido) => setCambios((actuales) => actuales.map((actual, i) => (i === indice ? cambio : actual))), [])
  const limpiar = useCallback(() => setCambios([]), [])

  /**
   * Edita un valor de un ítem existente reutilizando el último cambio del mismo tipo (para no
   * apilar diez "cantidad" seguidos) y quitándolo si el valor vuelve al que tenía antes.
   */
  const editarValor = useCallback((item: ItemBorrador, op: 'cantidad' | 'precio', construir: () => CambioPedido, igualAlPrevio: (previo: ItemBorrador) => boolean) => {
    if (!base) return
    setCambios((actuales) => {
      // Un ítem nuevo no existe en el servidor: se edita el "agregar" que lo creó.
      if (item.id < 0) {
        const origen = item.origenCambio
        const cambio = origen != null ? actuales[origen] : null
        if (!cambio || cambio.op !== 'agregar') return actuales
        const nuevo = construir()
        const siguiente: CambioPedido = nuevo.op === 'cantidad' ? { ...cambio, cantidad_presentacion: nuevo.cantidad_presentacion } : nuevo.op === 'precio' ? { ...cambio, precio_unitario: nuevo.precio_unitario, descuento_pct: nuevo.descuento_pct } : cambio
        return actuales.map((actual, i) => (i === origen ? siguiente : actual))
      }
      let ultimo = -1
      actuales.forEach((cambio, i) => { if (itemDe(cambio) === item.id) ultimo = i })
      if (ultimo >= 0 && actuales[ultimo].op === op) {
        const sin = actuales.filter((_, i) => i !== ultimo)
        const previo = aplicarCambios(base, sin).items.find((candidato) => candidato.id === item.id)
        if (previo && igualAlPrevio(previo)) return sin
        return actuales.map((actual, i) => (i === ultimo ? construir() : actual))
      }
      if (igualAlPrevio(item)) return actuales
      return [...actuales, construir()]
    })
  }, [base])

  const setCantidad = useCallback((item: ItemBorrador, cantidad: number) =>
    editarValor(item, 'cantidad', () => ({ op: 'cantidad', item_id: item.id, cantidad_presentacion: cantidad }), (previo) => previo.cantidad_presentacion === cantidad), [editarValor])
  const setPrecio = useCallback((item: ItemBorrador, precio: number) =>
    editarValor(item, 'precio', () => ({ op: 'precio', item_id: item.id, precio_unitario: precio, descuento_pct: item.descuento_pct }), (previo) => previo.precio_unitario === precio), [editarValor])

  /** Los datos del pedido son un único cambio: se reemplaza, o se quita si vuelven a los originales. */
  const setDatos = useCallback((datos: Omit<DatosCambio, 'op'>) => {
    if (!base) return
    setCambios((actuales) => {
      const sinDatos = actuales.filter((cambio) => cambio.op !== 'datos')
      const igual = datos.descuento_general === base.pedido.descuento_general && datos.condicion_pago === base.pedido.condicion_pago && datos.medio_pago === base.pedido.medio_pago && (datos.referencia ?? '') === (base.pedido.referencia ?? '')
      return igual ? sinDatos : [...sinDatos, { op: 'datos', ...datos }]
    })
  }, [base])

  /**
   * Tras VERSION_CAMBIADA: vuelve a pedir el detalle y reaplica los cambios en borrador sobre
   * la versión nueva. Los que ya no aplican se descartan y se devuelven para mostrarlos.
   */
  const recargar = useCallback(async () => {
    const fresco = await pedidoEdicionService.detalle(pedidoId)
    const { vigentes, descartados } = reaplicarCambios(fresco, cambios)
    setBase(fresco)
    setCambios(vigentes)
    return descartados
  }, [pedidoId, cambios])

  return { base, estado, cambios, resultado, resumen, agregarCambio, quitarCambio, reemplazarCambio, limpiar, setCantidad, setPrecio, setDatos, recargar }
}
