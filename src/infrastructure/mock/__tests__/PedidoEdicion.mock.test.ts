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
  { op: 'agregar', producto_id: null, presentacion_id: null, cantidad_presentacion: 12, precio_unitario: 4.5, descuento_pct: 0, es_personalizado: true, descripcion: 'Corrector líquido', unidad_medida: 'UNIDAD', faltante: null },
]

describe('pedidoEdicionMock (escenario PED-2026-00706)', () => {
  it('previsualiza +429,00 y saldo 1.037,00 sin escribir nada', async () => {
    const antes = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    const previa = await pedidoEdicionMock.previsualizar(PEDIDO_ESCENARIO_ID, antes.pedido.version, cambiosEscenario)
    expect(previa).toMatchObject({ total_anterior: 908, total_nuevo: 1337, delta: 429 })
    expect(previa.cuenta).toMatchObject({ saldo_antes: 608, saldo_despues: 1037, saldo_a_favor: 0 })
    expect(previa.almacen.map((a) => a.accion)).toEqual(expect.arrayContaining(['SIN_CAMBIO_FISICO', 'LINEA_NUEVA', 'AVISO_CERRADO']))
    expect(previa.errores).toEqual([])
    expect((await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)).pedido.total).toBe(908)
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
    expect(resultado).toEqual({ ok: true, version: fresca.pedido.version + 1, total: 1337 })

    const despues = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    expect(despues.cuenta).toMatchObject({ partida_total: 1337, saldo: 1037, sincronizada: true })
    expect(despues.avisos.map((a) => a.tipo)).toEqual(['SIN_CUBRIR'])
    expect(despues.items.every((item) => item.id > 0)).toBe(true)

    const tiempo = await pedidoEdicionMock.lineaTiempo(PEDIDO_ESCENARIO_ID)
    expect(tiempo.eventos[0]).toMatchObject({ actor_rol: 'SELLER', delta_total: 429, motivo: 'Cliente aceptó el sustituto', total_antes: 908, total_despues: 1337 })
    expect(tiempo.versiones[0]).toMatchObject({ version: resultado.version, total: 1337 })

    const [resumen] = await pedidoEdicionMock.resumenPedidos([PEDIDO_ESCENARIO_ID])
    expect(resumen).toMatchObject({ version: resultado.version, avisos: ['SIN_CUBRIR'] })
  })

  it('mantener precio cierra el aviso de sustitución sin tocar el dinero', async () => {
    const detalle = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    const aviso = detalle.avisos.find((a) => a.tipo === 'SIN_CUBRIR')
    if (!aviso) return
    await pedidoEdicionMock.resolverAviso(aviso.id, 'ACEPTAR')
    const despues = await pedidoEdicionMock.detalle(PEDIDO_ESCENARIO_ID)
    expect(despues.avisos).toEqual([])
    expect(despues.pedido.total).toBe(detalle.pedido.total)
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

  it('encuentra el código en el mensaje, el hint o los detalles del error de Postgres', () => {
    expect(extraerCodigoEdicion({ message: 'VERSION_CAMBIADA' })).toBe('VERSION_CAMBIADA')
    expect(extraerCodigoEdicion({ message: 'error', hint: 'PARTIR_NO_CUADRA' })).toBe('PARTIR_NO_CUADRA')
    expect(extraerCodigoEdicion({ message: 'otra cosa', details: 'x' })).toBeNull()
  })
})
