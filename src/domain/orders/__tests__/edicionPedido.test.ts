import { describe, expect, it } from 'vitest'
import { aplicarCambios, cambiosParaServidor, reaplicarCambios, resumenCambios } from '../edicionPedido'
import type { CambioPedido } from '../pedidoEdicion.types'
import { crearDetalleEscenario } from '../../../infrastructure/mock/PedidoEdicion.escenario'

const base = crearDetalleEscenario()
const agregarCorrector: CambioPedido = { op: 'agregar', producto_id: 9001, presentacion_id: null, cantidad_presentacion: 12, precio_unitario: 4.5, descuento_pct: 0, es_personalizado: false, descripcion: null, unidad_medida: null, cantidad_compra: 0, nombre: 'Corrector líquido' }
const partirTrijet: CambioPedido = {
  op: 'partir', item_id: 901, partes: [
    { producto_id: 4410, presentacion_id: 88, cantidad_presentacion: 200, precio_unitario: 0.85, linea_ids: [4746] },
    { producto_id: 850, presentacion_id: 91, cantidad_presentacion: 300, precio_unitario: 2, linea_ids: [4765], nombre: 'Wenao Colle' },
  ],
}
const fixocola20: CambioPedido = { op: 'cantidad', item_id: 903, cantidad_presentacion: 20 }

describe('aplicarCambios', () => {
  it('sin cambios deja el total del servidor intacto', () => {
    const r = aplicarCambios(base, [])
    expect(r.totalLocal).toBe(1060)
    expect(r.errores).toEqual([])
    expect(r.porItem.size).toBe(0)
  })

  it('agregar suma un ítem nuevo con id temporal y su línea de surtido', () => {
    const r = aplicarCambios(base, [agregarCorrector])
    const nuevo = r.items.at(-1)!
    expect(nuevo.id).toBeLessThan(0)
    expect(nuevo.subtotal).toBe(54)
    expect(nuevo.lineas).toHaveLength(1)
    expect(r.totalLocal).toBe(1114)
    expect(r.porItem.get(nuevo.id)).toBe('NUEVO')
  })

  it('agregar con cantidad_compra manda esa parte a Por comprar', () => {
    const r = aplicarCambios(base, [{ ...agregarCorrector, cantidad_compra: 12 }])
    expect(r.items.at(-1)!.lineas.map((l) => l.estado)).toEqual(['POR_COMPRAR'])
    const parcial = aplicarCambios(base, [{ ...agregarCorrector, cantidad_compra: 5 }])
    expect(parcial.items.at(-1)!.lineas.map((l) => [l.estado, l.cantidad_presentacion])).toEqual([['POR_DESPACHAR', 7], ['POR_COMPRAR', 5]])
  })

  it('cantidad recalcula el subtotal y marca el ítem como modificado', () => {
    const r = aplicarCambios(base, [fixocola20])
    expect(r.items.find((i) => i.id === 903)!.subtotal).toBe(120)
    expect(r.totalLocal).toBe(1090)
    expect(r.porItem.get(903)).toBe('MODIFICADO')
  })

  it('cantidad no puede bajar de lo despachado', () => {
    const r = aplicarCambios(base, [{ op: 'cantidad', item_id: 904, cantidad_presentacion: 5 }])
    expect(r.errores[0]).toMatchObject({ codigo: 'CANTIDAD_BAJO_DESPACHADO', item_id: 904 })
    expect(r.totalLocal).toBe(1060)
  })

  it('cantidad cero o negativa es inválida', () => {
    expect(aplicarCambios(base, [{ op: 'cantidad', item_id: 903, cantidad_presentacion: 0 }]).errores[0].codigo).toBe('CANTIDAD_INVALIDA')
  })

  it('precio cambia el subtotal con descuento', () => {
    const r = aplicarCambios(base, [{ op: 'precio', item_id: 902, precio_unitario: 12, descuento_pct: 10 }])
    expect(r.items.find((i) => i.id === 902)!.subtotal).toBe(162)
    expect(r.totalLocal).toBe(1057)
  })

  it('precio respeta precio_bloqueado del servidor', () => {
    const r = aplicarCambios(base, [{ op: 'precio', item_id: 901, precio_unitario: 1, descuento_pct: 0 }])
    expect(r.errores[0].codigo).toBe('PRECIO_BLOQUEADO')
    expect(r.errores[0].texto).toContain('autorización')
  })

  it('partir reparte el ítem y la primera parte conserva lo despachado', () => {
    const r = aplicarCambios(base, [partirTrijet])
    const primera = r.items.find((i) => i.id === 901)!
    const segunda = r.items.find((i) => i.origen_item_id === 901)!
    expect(primera.cantidad_presentacion).toBe(200)
    expect(primera.cantidad_despachada).toBe(200)
    expect(primera.lineas.map((l) => l.id)).toEqual([4746])
    expect(segunda.lineas.map((l) => l.id)).toEqual([4765])
    expect(segunda.subtotal).toBe(600)
    expect(r.totalLocal).toBe(1405)
    expect(r.porItem.get(901)).toBe('PARTIDO')
    expect(r.porItem.get(segunda.id)).toBe('PARTIDO')
  })

  it('partir exige que las partes sumen la cantidad del ítem', () => {
    const mal: CambioPedido = { op: 'partir', item_id: 901, partes: [{ producto_id: 4410, presentacion_id: 88, cantidad_presentacion: 200, precio_unitario: 0.85, linea_ids: [4746] }, { producto_id: 850, presentacion_id: 91, cantidad_presentacion: 200, precio_unitario: 2, linea_ids: [4765] }] }
    expect(aplicarCambios(base, [mal]).errores[0].codigo).toBe('PARTIR_NO_CUADRA')
  })

  it('partir: la primera parte no puede quedar bajo lo despachado', () => {
    const mal: CambioPedido = { op: 'partir', item_id: 901, partes: [{ producto_id: 4410, presentacion_id: 88, cantidad_presentacion: 100, precio_unitario: 0.85, linea_ids: [4746] }, { producto_id: 850, presentacion_id: 91, cantidad_presentacion: 400, precio_unitario: 2, linea_ids: [4765] }] }
    expect(aplicarCambios(base, [mal]).errores[0].codigo).toBe('CANTIDAD_BAJO_DESPACHADO')
  })

  it('quitar marca el ítem y resta su subtotal', () => {
    const r = aplicarCambios(base, [{ op: 'quitar', item_id: 902 }])
    expect(r.items.find((i) => i.id === 902)!.estado).toBe('QUITADO')
    expect(r.totalLocal).toBe(895)
    expect(r.porItem.get(902)).toBe('QUITADO')
  })

  it('quitar un ítem con despacho no se permite', () => {
    expect(aplicarCambios(base, [{ op: 'quitar', item_id: 901 }]).errores[0].codigo).toBe('ITEM_CON_DESPACHO')
  })

  it('quitar un ítem agregado en la misma edición lo saca sin rastro', () => {
    const r = aplicarCambios(base, [agregarCorrector, { op: 'quitar', item_id: -2 }])
    expect(r.errores).toEqual([])
    expect(r.items).toHaveLength(4)
  })

  it('sin cubrir sigue cobrándose: el subtotal del ítem no se descuenta', () => {
    const item = aplicarCambios(base, []).items.find((i) => i.id === 904)!
    expect(item.cantidad_sin_cubrir).toBe(4)
    expect(item.subtotal).toBe(380)
  })

  it('cerrar_saldo (cobrar solo lo entregado) deja el ítem en lo despachado y descarta lo pendiente', () => {
    const r = aplicarCambios(base, [{ op: 'cerrar_saldo', item_id: 904 }])
    const item = r.items.find((i) => i.id === 904)!
    expect(item.cantidad_presentacion).toBe(6)
    expect(item.cantidad_sin_cubrir).toBe(0)
    expect(item.lineas.map((l) => l.id)).toEqual([4790])
    expect(item.subtotal).toBe(228)
    expect(r.totalLocal).toBe(908)
  })

  it('cerrar_saldo sin unidades despachadas quita el ítem, como el servidor', () => {
    const r = aplicarCambios(base, [{ op: 'cerrar_saldo', item_id: 903 }])
    expect(r.errores).toEqual([])
    expect(r.items.find((i) => i.id === 903)!.estado).toBe('QUITADO')
    expect(r.totalLocal).toBe(970)
  })

  it('saldo_a_compra pasa lo sin cubrir a cobrarse y deja la línea por comprar', () => {
    const r = aplicarCambios(base, [{ op: 'saldo_a_compra', item_id: 904 }])
    const item = r.items.find((i) => i.id === 904)!
    expect(item.cantidad_sin_cubrir).toBe(0)
    expect(item.lineas.find((l) => l.id === 4791)!.estado).toBe('POR_COMPRAR')
    expect(item.subtotal).toBe(380)
    expect(r.totalLocal).toBe(1060)
  })

  it('saldo_a_compra sin saldo sin cubrir es un error', () => {
    expect(aplicarCambios(base, [{ op: 'saldo_a_compra', item_id: 902 }]).errores[0].codigo).toBe('SIN_FALTANTE')
  })

  it('cambiar_producto_saldo mueve lo sin cubrir a un ítem nuevo con su precio', () => {
    const r = aplicarCambios(base, [{ op: 'cambiar_producto_saldo', item_id: 904, producto_id: 777, presentacion_id: 60, precio_unitario: 35, nombre: 'Bond Alfa carta' }])
    const original = r.items.find((i) => i.id === 904)!
    const nuevo = r.items.find((i) => i.origen_item_id === 904)!
    expect(original.cantidad_presentacion).toBe(6)
    expect(original.cantidad_sin_cubrir).toBe(0)
    expect(nuevo.cantidad_presentacion).toBe(4)
    expect(nuevo.subtotal).toBe(140)
    expect(r.totalLocal).toBe(1048)
  })

  it('datos cambia el descuento general y el total', () => {
    const r = aplicarCambios(base, [{ op: 'datos', descuento_general: 8, condicion_pago: 'CONTADO', medio_pago: 'QR', referencia: 'Entrega jueves' }])
    expect(r.totalLocal).toBe(1052)
    expect(aplicarCambios(base, [{ op: 'datos', referencia: 'x' }]).datos).toMatchObject({ descuento_general: 0, condicion_pago: 'CREDITO', referencia: 'x' })
    expect(r.datos).toMatchObject({ condicion_pago: 'CONTADO', medio_pago: 'QR', referencia: 'Entrega jueves' })
  })

  it('un ítem inexistente se reporta y no rompe el resto', () => {
    const r = aplicarCambios(base, [{ op: 'quitar', item_id: 12345 }, fixocola20])
    expect(r.errores[0].codigo).toBe('ITEM_NO_ENCONTRADO')
    expect(r.totalLocal).toBe(1090)
  })

  it('no muta el detalle base', () => {
    const copia = JSON.stringify(base)
    aplicarCambios(base, [partirTrijet, fixocola20, agregarCorrector])
    expect(JSON.stringify(base)).toBe(copia)
  })

  it('escenario completo del canvas: 1.060,00 → 1.489,00 (+429,00)', () => {
    const r = aplicarCambios(base, [partirTrijet, fixocola20, agregarCorrector])
    expect(r.errores).toEqual([])
    expect(r.totalLocal).toBe(1489)
    expect(r.totalLocal - base.pedido.total).toBe(429)
    expect(r.totalLocal - base.cuenta.pagado).toBe(1189)
  })
})

describe('resumenCambios', () => {
  it('describe cada cambio con su efecto en el total (+345, +30, +54)', () => {
    const resumen = resumenCambios([partirTrijet, fixocola20, agregarCorrector], base)
    expect(resumen.map((r) => r.delta)).toEqual([345, 30, 54])
    expect(resumen[0].texto).toBe('Partir Trijet Digno 0.7 azul en 2 partes')
    expect(resumen[1].texto).toBe('Fixocola: cantidad 15 → 20')
    expect(resumen[2].texto).toBe('Agregar Corrector líquido × 12')
    expect(resumen.reduce((total, r) => total + r.delta, 0)).toBe(429)
  })

  it('describe el resto de operaciones', () => {
    const textos = resumenCambios([
      { op: 'precio', item_id: 902, precio_unitario: 12, descuento_pct: 0 },
      { op: 'quitar', item_id: 903 },
      { op: 'cerrar_saldo', item_id: 904 },
    ], base).map((r) => r.texto)
    expect(textos).toEqual(['Fastener: precio Bs 11.00 → Bs 12.00', 'Quitar Fixocola', 'Cerrar saldo de Bond Brío carta'])
  })
})

describe('cambiosParaServidor', () => {
  it('quita los campos solo-de-interfaz', () => {
    const [agregar, partir] = cambiosParaServidor([agregarCorrector, partirTrijet]) as Array<Record<string, unknown>>
    expect(agregar).not.toHaveProperty('nombre')
    expect((partir.partes as Array<Record<string, unknown>>)[1]).not.toHaveProperty('nombre')
    expect(partir.partes).toHaveLength(2)
  })

  it('emite las formas exactas del addendum', () => {
    const [agregar, cantidad, partir, saldo, datos] = cambiosParaServidor([
      agregarCorrector,
      { op: 'cantidad', item_id: 903, cantidad_presentacion: 20 },
      partirTrijet,
      { op: 'cambiar_producto_saldo', item_id: 904, producto_id: 777, presentacion_id: null, precio_unitario: 35, nombre: 'X' },
      { op: 'datos', referencia: 'x' },
    ]) as Array<Record<string, unknown>>
    expect(agregar).toMatchObject({ op: 'agregar', cantidad_compra: 0 })
    expect(agregar).not.toHaveProperty('faltante')
    expect(cantidad).toEqual({ op: 'cantidad', item_id: 903, cantidad_presentacion: 20, cantidad_compra: 0 })
    const [parte0, parte1] = partir.partes as Array<Record<string, unknown>>
    expect(parte0).toEqual({ cantidad_presentacion: 200, precio_unitario: 0.85 })
    expect(parte1).toEqual({ producto_id: 850, presentacion_id: 91, cantidad_presentacion: 300, precio_unitario: 2, linea_ids: [4765] })
    expect(saldo).toEqual({ op: 'cambiar_producto_saldo', item_id: 904, producto_id: 777, presentacion_id: null, precio_unitario: 35, cantidad_compra: 0 })
    expect(datos).toEqual({ op: 'datos', referencia: 'x' })
  })
})

describe('reaplicarCambios', () => {
  it('descarta los cambios que ya no aplican sobre la base nueva', () => {
    const nueva = crearDetalleEscenario()
    nueva.items[3].cantidad_despachada = 10
    const { vigentes, descartados } = reaplicarCambios(nueva, [{ op: 'cantidad', item_id: 904, cantidad_presentacion: 8 }, fixocola20])
    expect(vigentes).toEqual([fixocola20])
    expect(descartados[0].texto).toContain('despachado')
  })
})
