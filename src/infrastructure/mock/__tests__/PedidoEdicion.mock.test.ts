import { describe, expect, it } from 'vitest'
import type { CambioPedido } from '../../../domain/orders/pedidoEdicion.types'
import { EdicionPedidoError, extraerCodigoEdicion, mapErrorEdicion } from '../../supabase/PedidoEdicion.supabase'
import { pedidoEdicionMock, simularCambioDeAlmacen } from '../PedidoEdicion.mock'
import { PEDIDO_ESCENARIO_ID } from '../PedidoEdicion.escenario'

const cambiosEscenario: CambioPedido[] = [
  { op: 'partir', item_id: 901, partes: [
    { producto_id: 4410, presentacion_id: 88, cantidad_presentacion: 200, precio_unitario: 0.85, linea_ids: [4746] },
    { producto_id: 850, presentacion_id: 91, cantidad_presentacion: 300, precio_unitario: 2, linea_ids: [4765], nombre: 'Wenao Colle' },
  ] },
  { op: 'cantidad', item_id: 903, cantidad_presentacion: 20 },
  { op: 'agregar', producto_id: null, presentacion_id: null, cantidad_presentacion: 12, precio_unitario: 4.5, descuento_pct: 0, es_personalizado: true, descripcion: 'Corrector líquido', unidad_medida: 'UNIDAD', cantidad_compra: 0 },
]

describe('pedidoEdicionMock (escenario PED-2026-00706)', () => {
  it('previsualiza +429,00 y saldo 1.189,00 sin escribir nada', async () => {
    const antes = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    const previa = await pedidoEdicionMock.previsualizar(PEDIDO_ESCENARIO_ID, antes.pedido.version, cambiosEscenario)
    expect(previa).toMatchObject({ total_anterior: 1060, total_nuevo: 1489, delta: 429 })
    expect(previa.cuenta).toMatchObject({ saldo_antes: 760, saldo_despues: 1189, saldo_a_favor: 0 })
    expect(previa.almacen.map((a) => a.accion)).toEqual(expect.arrayContaining(['LINEA_NUEVA']))
    expect(previa.errores).toEqual([])
    expect((await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)).pedido.total).toBe(1060)
  })

  it('rechaza una edición sin motivo y una con versión vieja; luego guarda y deja la sesión en la línea de tiempo', async () => {
    const base = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    await expect(pedidoEdicionMock.editar(PEDIDO_ESCENARIO_ID, base.pedido.version, cambiosEscenario, '  ')).rejects.toMatchObject({ codigo: 'MOTIVO_REQUERIDO' })

    simularCambioDeAlmacen(PEDIDO_ESCENARIO_ID)
    const error = await pedidoEdicionMock.editar(PEDIDO_ESCENARIO_ID, base.pedido.version, cambiosEscenario, 'Cliente aceptó el sustituto').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdicionPedidoError)
    expect((error as EdicionPedidoError).codigo).toBe('VERSION_CAMBIADA')

    const fresca = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    const resultado = await pedidoEdicionMock.editar(PEDIDO_ESCENARIO_ID, fresca.pedido.version, cambiosEscenario, 'Cliente aceptó el sustituto')
    expect(resultado).toEqual({ ok: true, version: fresca.pedido.version + 1, total_anterior: 1060, total_nuevo: 1489, delta: 429 })

    const despues = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    expect(despues.cuenta).toMatchObject({ partida_total: 1489, saldo: 1189, sincronizada: true })
    expect(despues.avisos.map((a) => a.tipo)).toEqual(['SIN_CUBRIR'])
    expect(despues.items.every((item) => item.id > 0)).toBe(true)

    const tiempo = await pedidoEdicionMock.lineaTiempo(PEDIDO_ESCENARIO_ID)
    expect(tiempo.eventos[0]).toMatchObject({ actor_rol: 'SELLER', delta_total: 429, motivo: 'Cliente aceptó el sustituto', total_antes: 1060, total_despues: 1489 })
    expect(tiempo.versiones[0]).toMatchObject({ version: resultado.version, total: 1489 })

    const [resumen] = await pedidoEdicionMock.resumenPedidos([PEDIDO_ESCENARIO_ID])
    expect(resumen).toMatchObject({ version: resultado.version, avisos: ['SIN_CUBRIR'] })
  })

  it('los avisos de sin cubrir no se resuelven con resolver_aviso (solo sustituciones)', async () => {
    const detalle = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    const aviso = detalle.avisos.find((a) => a.tipo === 'SIN_CUBRIR')
    if (!aviso) return
    await expect(pedidoEdicionMock.resolverAviso(aviso.id, 'MANTENER_PRECIO')).rejects.toMatchObject({ codigo: 'ACCION_INVALIDA' })
  })

  it('bajar el pedido por debajo de lo pagado se bloquea con REDUCCION_BAJO_PAGADO', async () => {
    const detalle = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    const bajar: CambioPedido[] = [{ op: 'quitar', item_id: 902 }, { op: 'quitar', item_id: 903 }, { op: 'datos', descuento_general: 1500 }]
    const previa = await pedidoEdicionMock.previsualizar(PEDIDO_ESCENARIO_ID, detalle.pedido.version, bajar)
    expect(previa.errores.map((e) => e.codigo)).toContain('REDUCCION_BAJO_PAGADO')
    expect(previa).toMatchObject({ ok: false, cuenta: null, total_anterior: null, total_nuevo: null, delta: null })
    await expect(pedidoEdicionMock.editar(PEDIDO_ESCENARIO_ID, detalle.pedido.version, bajar, 'x')).rejects.toMatchObject({ codigo: 'REDUCCION_BAJO_PAGADO' })
  })
})

describe('errores de edición', () => {
  it('mapea cada código a su mensaje en español', () => {
    expect(mapErrorEdicion('CANTIDAD_BAJO_DESPACHADO')).toBe('No puedes bajar de lo ya despachado.')
    expect(mapErrorEdicion('ITEM_CON_DESPACHO')).toBe('Ese ítem ya tiene unidades despachadas: usa Cerrar saldo.')
    expect(mapErrorEdicion('PARTIR_NO_CUADRA')).toBe('Las partes no suman la cantidad del ítem.')
    expect(mapErrorEdicion('PRECIO_REQUIERE_AUTORIZACION')).toBe('Cambiar el precio de lo ya despachado o pagado requiere autorización.')
    expect(mapErrorEdicion('CLIENTE_CON_PAGOS')).toBe('El cliente no se puede cambiar: la partida tiene pagos.')
    expect(mapErrorEdicion('SIN_PERMISO')).toBe('No tienes permiso para editar este pedido.')
    expect(mapErrorEdicion('PEDIDO_NO_EDITABLE')).toBe('Este pedido ya no se puede editar.')
    expect(mapErrorEdicion('MOTIVO_REQUERIDO')).toBe('Escribe el motivo del cambio.')
  })

  it('toma el código solo de error.hint', () => {
    expect(extraerCodigoEdicion({ hint: 'PARTIR_NO_CUADRA' })).toBe('PARTIR_NO_CUADRA')
    expect(extraerCodigoEdicion({ hint: 'PARTIDA_DESFASADA' })).toBe('PARTIDA_DESFASADA')
    expect(extraerCodigoEdicion({ hint: null })).toBeNull()
    expect(extraerCodigoEdicion({ hint: 'NO_EXISTE' })).toBeNull()
  })
})
