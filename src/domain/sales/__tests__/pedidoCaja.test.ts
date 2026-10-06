import { describe, expect, it } from 'vitest'
import type { PedidoVendedorLinea, PedidoVendedorRecord } from '../../../application/shared/models'
import {
  bloqueos, cambiarPresentacionCaja, construirCobro, editarCantidad, editarPrecio, lineaAgregada, lineasDesdePedido, minutosEsperando, necesitaMotivo,
  parsearCodigoPedido, quitarLinea, restaurarLinea, totalCents, totalVendedorCents, verificarPorEscaneo, type LineaCaja,
} from '../pedidoCaja'

const lin = (over: Partial<PedidoVendedorLinea>): PedidoVendedorLinea => ({
  lineaId: '31', orden: 1, productoId: 49, nombre: 'Resma', sku: 'RC', presentacionId: 47, presentacion: 'Unidad', esBase: true, factor: 1, esPersonalizado: false,
  unidadMedida: null, cantidad: 3, precioLista: 15, precioMinimo: 13.5, precioUnitario: 15, subtotal: 45, resultado: null, cantidadFinal: null, precioFinal: null, motivoCaja: null, ...over,
})
const pedido = (lineas: PedidoVendedorLinea[]): PedidoVendedorRecord => ({
  pedidoId: '9', codigo: 'PDV-9', numeroDia: 3, fecha: '2026-10-06', estado: 'EN_CAJA', vendedor: 'Ana', nota: null, total: 0, enviadoEn: '2026-10-06T22:00:00Z',
  tomadoPor: 'Rony', ventaNumero: null, anuladoOrigen: null, anuladoMotivo: null, reintento: false, lineas,
})
const caja = (lineas: PedidoVendedorLinea[]): LineaCaja[] => lineasDesdePedido(pedido(lineas))
const base = caja([lin({})])[0]
const pack = caja([lin({ lineaId: '34', orden: 2, productoId: 4, presentacionId: 3001, presentacion: 'Caja', esBase: false, factor: 10, cantidad: 1, precioLista: 600, precioMinimo: null, precioUnitario: 600 })])[0]
const custom = caja([lin({ lineaId: '33', orden: 3, productoId: null, nombre: 'Cartulina verde', sku: null, presentacionId: null, presentacion: null, esPersonalizado: true, unidadMedida: 'UNIDAD', cantidad: 5, precioLista: null, precioMinimo: null, precioUnitario: 3 })])[0]

describe('parsearCodigoPedido', () => {
  it.each([['PDV-9', '9'], ['pdv-9', '9'], ['PDV9', '9'], ["PDV'9", '9'], ['  PDV-120 ', '120']])('acepta %s', (texto, id) => { expect(parsearCodigoPedido(texto)).toBe(id) })
  it.each(['PDV-', 'PDV--9', 'ABC-9', '7701', 'PDV-9X', 'XPDV-9', '', 'PDV-9 10'])('rechaza %s', (texto) => { expect(parsearCodigoPedido(texto)).toBeNull() })
})

describe('lineasDesdePedido', () => {
  it('conserva lo del vendedor, queda sin verificar y usa una clave estable', () => {
    expect(base).toMatchObject({ key: 'pl-31', pedidoLineaId: '31', cantidad: 3, cantidadVendedor: 3, precioCents: 1500, precioVendedorCents: 1500, precioListaCents: 1500, precioMinimoCents: 1350, verificada: false, quitada: false, agregada: false, presentacionId: null })
    expect(pack).toMatchObject({ presentacionId: 3001, presentacionNombre: 'Caja', esBase: false, factor: 10, precioRetailCents: 6000, precioMinimoCents: null })
    expect(custom).toMatchObject({ esPersonalizado: true, productoId: null, precioRetailCents: null })
  })
  it('ordena por orden', () => {
    const l = caja([lin({ lineaId: '2', orden: 2 }), lin({ lineaId: '1', orden: 1 })])
    expect(l.map((x) => x.key)).toEqual(['pl-1', 'pl-2'])
  })
})

describe('verificarPorEscaneo', () => {
  const dos = caja([lin({ lineaId: '1', orden: 1 }), lin({ lineaId: '2', orden: 2, presentacionId: 3001, presentacion: 'Caja', esBase: false, factor: 10 })])
  it('marca la primera sin verificar y avisa cuando ya estaba o no está', () => {
    const a = verificarPorEscaneo(dos, 49)
    expect(a.resultado).toBe('verificada')
    expect(a.lineas.map((l) => l.verificada)).toEqual([true, false])
    const b = verificarPorEscaneo(a.lineas, 49)
    expect(b.lineas.map((l) => l.verificada)).toEqual([true, true])
    expect(verificarPorEscaneo(b.lineas, 49).resultado).toBe('ya_verificada')
    expect(verificarPorEscaneo(dos, 999).resultado).toBe('no_esta')
  })
  it('prefiere la misma presentación (null = base)', () => {
    expect(verificarPorEscaneo(dos, 49, 3001).lineas.map((l) => l.verificada)).toEqual([false, true])
    expect(verificarPorEscaneo(dos, 49, null).lineas.map((l) => l.verificada)).toEqual([true, false])
  })
  it('una línea quitada no cuenta', () => {
    const q = dos.map((l) => quitarLinea(l))
    expect(verificarPorEscaneo(q, 49).resultado).toBe('no_esta')
  })
})

describe('necesitaMotivo', () => {
  it('un precio editado por debajo del mínimo exige motivo; en el mínimo, no', () => {
    expect(necesitaMotivo(base)).toBe(false)
    expect(necesitaMotivo(editarPrecio(base, 1349))).toBe(true)
    expect(necesitaMotivo(editarPrecio(base, 1350))).toBe(false)
  })
  it('una línea de paquete o personalizada nunca lo necesita', () => {
    expect(necesitaMotivo(editarPrecio(pack, 1))).toBe(false)
    expect(necesitaMotivo(editarPrecio(custom, 1))).toBe(false)
  })
  it('al cambiar a paquete deja de necesitarlo y al volver a base se recalcula con precioMinimoLocal', () => {
    const bajo = editarPrecio(base, 1000)
    const enPaquete = cambiarPresentacionCaja(bajo, { id: 3001, nombre: 'Caja', factorUnidadBase: 10, esBase: false })
    expect(enPaquete).toMatchObject({ presentacionId: 3001, precioCents: 15000, precioMinimoCents: null, verificada: true })
    expect(necesitaMotivo(editarPrecio(enPaquete, 100))).toBe(false)
    const deVuelta = cambiarPresentacionCaja(enPaquete, { id: 47, nombre: 'Unidad', factorUnidadBase: 1, esBase: true })
    expect(deVuelta).toMatchObject({ presentacionId: null, precioCents: 1500, precioMinimoCents: 1350 })
  })
  it('una línea agregada en caja usa precioMinimoLocal (lista 25 → 22,50)', () => {
    const a = lineaAgregada({ id: 51, nombre: 'Marcador', sku: 'M', precioRetail: 25 }, 'k')
    expect(a).toMatchObject({ pedidoLineaId: null, agregada: true, verificada: true, cantidad: 1, precioCents: 2500, precioMinimoCents: 2250 })
    expect(necesitaMotivo(editarPrecio(a, 2249))).toBe(true)
    expect(necesitaMotivo(editarPrecio(a, 2250))).toBe(false)
  })
  it('una línea quitada no lo necesita', () => { expect(necesitaMotivo(quitarLinea(editarPrecio(base, 100)))).toBe(false) })
})

describe('ediciones', () => {
  it('editar cantidad o precio deja la línea verificada; quitar y deshacer', () => {
    expect(editarCantidad(base, 2).verificada).toBe(true)
    expect(editarPrecio(base, 1400).verificada).toBe(true)
    const q = quitarLinea(base, 'Sin stock')
    expect(q).toMatchObject({ quitada: true, motivoQuitada: 'Sin stock' })
    expect(restaurarLinea(q)).toMatchObject({ quitada: false, motivoQuitada: undefined })
  })
})

describe('totalCents', () => {
  it('redondea por línea en centavos y excluye las quitadas', () => {
    const a = { ...base, precioCents: 1455, cantidad: 3.5 }       // 5092,5 → 5093 = round(14,55 × 3,5 = 50,925, 2)
    const b = { ...base, key: 'b', precioCents: 333, cantidad: 3 } // 999
    expect(totalCents([a])).toBe(5093)
    expect(totalCents([a, b])).toBe(6092)
    expect(totalCents([a, quitarLinea(b)])).toBe(5093)
  })
  it('totalVendedorCents suma solo lo del pedido con lo que dejó el vendedor', () => {
    const agregada = lineaAgregada({ id: 1, nombre: 'X', sku: '', precioRetail: 10 }, 'k')
    expect(totalVendedorCents([editarPrecio(base, 1000), agregada])).toBe(4500)
  })
})

describe('bloqueos', () => {
  it('sin verificar, sin motivo, sin líneas y total cero bloquean; con todo en orden no queda nada', () => {
    expect(bloqueos([base])[0]).toMatch(/Faltan 1 línea por verificar o quitar/)
    expect(bloqueos([base, { ...pack, key: 'p' }])[0]).toMatch(/Faltan 2 líneas/)
    const sinMotivo = editarPrecio(base, 1000)
    expect(bloqueos([sinMotivo])).toEqual(['Falta el motivo del descuento en 1 línea'])
    expect(bloqueos([{ ...sinMotivo, motivoDescuento: '  ' }])).toHaveLength(1)
    expect(bloqueos([{ ...sinMotivo, motivoDescuento: 'Producto dañado' }])).toEqual([])
    expect(bloqueos([])).toEqual(['No queda ningún producto en el pedido'])
    expect(bloqueos([quitarLinea(base)])).toEqual(['No queda ningún producto en el pedido'])
    expect(bloqueos([editarPrecio(custom, 0)])).toEqual(['El total es cero'])
  })
  it('una línea quitada no exige verificación', () => {
    expect(bloqueos([quitarLinea(base), editarCantidad(pack, 1)])).toEqual([])
  })
})

describe('construirCobro', () => {
  it('unidad base: cantidad_base, origen Tienda (2), pedido_linea_id y verificada', () => {
    const r = construirCobro([editarCantidad(base, 3)])
    expect(r.lineas).toEqual([{ producto_id: 49, cantidad_base: 3, precio_unitario: 15, sucursal_origen_id: 2, pedido_linea_id: 31, verificada: true }])
    expect(r.quitadas).toEqual([])
    expect(r.totalCents).toBe(4500)
  })
  it('paquete: presentacion_id + cantidad_presentacion', () => {
    expect(construirCobro([editarCantidad(pack, 1)]).lineas).toEqual([{ producto_id: 4, presentacion_id: 3001, cantidad_presentacion: 1, precio_unitario: 600, sucursal_origen_id: 2, pedido_linea_id: 34, verificada: true }])
  })
  it('personalizada: sin producto_id ni origen, cantidad_base y unidad', () => {
    expect(construirCobro([editarCantidad(custom, 5)]).lineas).toEqual([{ es_personalizado: true, descripcion: 'Cartulina verde', unidad_medida: 'UNIDAD', cantidad_base: 5, precio_unitario: 3, pedido_linea_id: 33, verificada: true }])
  })
  it('agregada en caja: sin pedido_linea_id ni verificada', () => {
    const a = lineaAgregada({ id: 51, nombre: 'Marcador', sku: 'M', precioRetail: 25 }, 'k')
    const [l] = construirCobro([a]).lineas
    expect(l).toEqual({ producto_id: 51, cantidad_base: 1, precio_unitario: 25, sucursal_origen_id: 2 })
    expect(l).not.toHaveProperty('pedido_linea_id')
    expect(l).not.toHaveProperty('verificada')
  })
  it('motivo_descuento solo cuando hay descuento bajo el mínimo', () => {
    const conDescuento = { ...editarPrecio(base, 1000), motivoDescuento: 'Cliente frecuente' }
    expect(construirCobro([conDescuento]).lineas[0]).toMatchObject({ precio_unitario: 10, motivo_descuento: 'Cliente frecuente' })
    expect(construirCobro([{ ...editarPrecio(base, 1400), motivoDescuento: 'Cliente frecuente' }]).lineas[0]).not.toHaveProperty('motivo_descuento')
  })
  it('las quitadas van a quitadas (con y sin motivo) y no a lineas; una agregada quitada se descarta', () => {
    const agregadaQuitada = quitarLinea(lineaAgregada({ id: 51, nombre: 'M', sku: '', precioRetail: 5 }, 'k'))
    const r = construirCobro([quitarLinea(base, 'No lo lleva'), quitarLinea(pack), editarCantidad(custom, 5), agregadaQuitada])
    expect(r.quitadas).toEqual([{ pedido_linea_id: 31, motivo: 'No lo lleva' }, { pedido_linea_id: 34 }])
    expect(r.lineas).toHaveLength(1)
    expect(r.lineas[0]).toMatchObject({ pedido_linea_id: 33 })
    expect(r.totalCents).toBe(1500)
  })
})

describe('minutosEsperando', () => {
  it('minutos enteros y nunca negativos', () => {
    const t = new Date('2026-10-06T22:00:00Z').getTime()
    expect(minutosEsperando('2026-10-06T22:00:00Z', t + 4 * 60000 + 59000)).toBe(4)
    expect(minutosEsperando('2026-10-06T22:00:00Z', t - 5000)).toBe(0)
    expect(minutosEsperando(null)).toBeNull()
  })
})
