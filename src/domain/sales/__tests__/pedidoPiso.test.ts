import { describe, expect, it } from 'vitest'
import type { PedidoVendedorRecord } from '../../../application/shared/models'
import {
  aLineasPayload, aceptarLectura, agregarPersonalizado, agregarProducto, bajoElMinimo, cambiarPresentacion, esErrorDeRed, fusionarRespuesta,
  pedidoDesdeServidor, precioMinimoLocal, precioSugerido, puedeEnviar, totalPedido, type LineaPiso, type PedidoLocal, type PresentacionPiso,
} from '../pedidoPiso'

const prod = { id: 49, nombre: 'Resma carta', sku: 'RC-1', precioRetail: 25 }
const caja: PresentacionPiso = { id: 3001, nombre: 'Caja x10', factorUnidadBase: 10, esBase: false }
const base: PresentacionPiso = { id: 47, nombre: 'Unidad', factorUnidadBase: 1, esBase: true }
let n = 0
const id = () => `l${++n}`

describe('precioMinimoLocal (piso del 10 %)', () => {
  it('lista 25: 22.50 se permite y 22.49 se rechaza', () => {
    const min = precioMinimoLocal(25, true)
    expect(min).toBe(22.5)
    expect(bajoElMinimo(22.5, min)).toBe(false)
    expect(bajoElMinimo(22.49, min)).toBe(true)
  })
  it('redondea a 2 decimales', () => { expect(precioMinimoLocal(14.55, true)).toBe(13.1) })
  it('paquetes, productos sin precio y personalizados no tienen mínimo', () => {
    expect(precioMinimoLocal(25, false)).toBeNull()
    expect(precioMinimoLocal(0, true)).toBeNull()
    expect(precioMinimoLocal(null, true)).toBeNull()
    expect(bajoElMinimo(1, null)).toBe(false)
  })
})

describe('precioSugerido', () => {
  it('precio base × factor, redondeado', () => {
    expect(precioSugerido(25, 10)).toBe(250)
    expect(precioSugerido(3.333, 3)).toBe(10)
    expect(precioSugerido(0, 10)).toBeNull()
    expect(precioSugerido(null, 1)).toBeNull()
  })
})

describe('agregarProducto', () => {
  it('mismo producto y misma presentación suma 1; otra presentación es otra línea', () => {
    let l = agregarProducto([], prod, undefined, id())
    l = agregarProducto(l, prod, base, id())
    expect(l).toHaveLength(1)
    expect(l[0].cantidad).toBe(2)
    l = agregarProducto(l, prod, caja, id())
    expect(l).toHaveLength(2)
    expect(l[1]).toMatchObject({ presentacionId: 3001, factor: 10, precioUnitario: 250, precioMinimo: null, esBase: false })
    l = agregarProducto(l, prod, caja, id())
    expect(l.map((x) => x.cantidad)).toEqual([2, 2])
  })
  it('línea base: mínimo local y precio de lista; producto sin precio queda sin precio', () => {
    const [a] = agregarProducto([], prod, undefined, id())
    expect(a).toMatchObject({ precioUnitario: 25, precioMinimo: 22.5, presentacionId: null })
    const [b] = agregarProducto([], { ...prod, id: 5, precioRetail: 0 }, undefined, id())
    expect(b).toMatchObject({ precioUnitario: null, precioMinimo: null, precioRetail: null })
  })
  it('un ítem personalizado nunca se mezcla con uno de catálogo', () => {
    let l = agregarPersonalizado([], { descripcion: ' Cartulina ', unidadMedida: 'UNIDAD', cantidad: 5, precio: 3 }, id())
    l = agregarProducto(l, prod, undefined, id())
    expect(l).toHaveLength(2)
    expect(l[0]).toMatchObject({ nombre: 'Cartulina', esPersonalizado: true, precioMinimo: null })
  })
})

describe('cambiarPresentacion', () => {
  it('reinicia el precio al sugerido y quita el mínimo en paquetes', () => {
    const [l] = agregarProducto([], prod, undefined, id())
    const c = cambiarPresentacion({ ...l, precioUnitario: 23 }, caja)
    expect(c).toMatchObject({ presentacionId: 3001, precioUnitario: 250, precioMinimo: null, factor: 10 })
    expect(cambiarPresentacion(c, base)).toMatchObject({ presentacionId: null, precioUnitario: 25, precioMinimo: 22.5, factor: 1 })
  })
})

describe('totalPedido / puedeEnviar', () => {
  it('suma round2(precio × cantidad) y cuenta las líneas sin precio', () => {
    const l = [
      { ...agregarProducto([], prod, undefined, id())[0], cantidad: 3, precioUnitario: 14.55 },
      { ...agregarProducto([], { ...prod, id: 2, precioRetail: 0 }, undefined, id())[0] },
    ]
    expect(totalPedido(l)).toEqual({ total: 43.65, sinPrecio: 1 })
    expect(puedeEnviar(l)).toBe(false)
    expect(puedeEnviar([l[0]])).toBe(true)
    expect(puedeEnviar([])).toBe(false)
  })
})

describe('aLineasPayload', () => {
  it('arma catálogo y personalizado; omite el precio mientras no exista', () => {
    const lineas: LineaPiso[] = [
      ...agregarProducto([], prod, caja, id()),
      ...agregarProducto([], { ...prod, id: 7, precioRetail: 0 }, undefined, id()),
      ...agregarPersonalizado([], { descripcion: 'Cartulina verde', unidadMedida: 'UNIDAD', cantidad: 5, precio: 3 }, id()),
    ]
    expect(aLineasPayload(lineas)).toEqual([
      { productoId: 49, presentacionId: 3001, cantidad: 1, precioUnitario: 250 },
      { productoId: 7, presentacionId: null, cantidad: 1 },
      { esPersonalizado: true, descripcion: 'Cartulina verde', unidadMedida: 'UNIDAD', cantidad: 5, precioUnitario: 3 },
    ])
  })
})

describe('aceptarLectura (de-duplicación 1500 ms)', () => {
  it('ignora el mismo código dentro de la ventana y lo acepta después', () => {
    let r = aceptarLectura({}, '7701', 1000)
    expect(r.aceptada).toBe(true)
    r = aceptarLectura(r.recientes, '7701', 2499)
    expect(r.aceptada).toBe(false)
    r = aceptarLectura(r.recientes, '7701', 2500)
    expect(r.aceptada).toBe(true)
  })
  it('un código distinto se acepta enseguida', () => {
    const a = aceptarLectura({}, '7701', 1000)
    expect(aceptarLectura(a.recientes, '7702', 1100).aceptada).toBe(true)
  })
  it('una lectura ignorada no extiende la ventana', () => {
    const a = aceptarLectura({}, 'x', 0)
    const b = aceptarLectura(a.recientes, 'x', 1000)
    expect(b.recientes.x).toBe(0)
    expect(aceptarLectura(b.recientes, 'x', 1500).aceptada).toBe(true)
  })
})

const server = (over: Partial<PedidoVendedorRecord> = {}): PedidoVendedorRecord => ({
  pedidoId: '9', codigo: 'PDV-9', numeroDia: 12, fecha: '2026-10-06', estado: 'ARMANDO', vendedor: 'Ana', nota: null, total: 0, enviadoEn: null, tomadoPor: null,
  ventaNumero: null, anuladoOrigen: null, anuladoMotivo: null, reintento: false,
  lineas: [
    { lineaId: '31', orden: 1, productoId: 49, nombre: 'Resma', sku: 'RC', presentacionId: 47, presentacion: 'Unidad', esBase: true, factor: 1, esPersonalizado: false, unidadMedida: null, cantidad: 2, precioLista: 25, precioMinimo: 22.5, precioUnitario: 24, subtotal: 48, resultado: null, cantidadFinal: null, precioFinal: null, motivoCaja: null },
    { lineaId: '32', orden: 2, productoId: 7, nombre: 'Caja', sku: null, presentacionId: 3001, presentacion: 'Caja', esBase: false, factor: 10, esPersonalizado: false, unidadMedida: null, cantidad: 1, precioLista: 250, precioMinimo: null, precioUnitario: 250, subtotal: 250, resultado: null, cantidadFinal: null, precioFinal: null, motivoCaja: null },
  ],
  ...over,
})
const local = (): PedidoLocal => ({
  clave: 'k', pedidoId: null, codigo: null, numeroDia: null, estado: 'ARMANDO', nota: null, revision: 3, guardadoRevision: 0, creadoEn: 'x', snapshot: null,
  lineas: [{ ...agregarProducto([], prod, undefined, 'a')[0], precioUnitario: 24 }, { ...agregarProducto([], { ...prod, id: 7 }, caja, 'b')[0], error: 'viejo' }],
})

describe('fusionarRespuesta', () => {
  it('aplica número del día, lista y mínimo por orden (no por linea_id) y marca la revisión como guardada', () => {
    const r = fusionarRespuesta(local(), server(), 3)
    expect(r).toMatchObject({ pedidoId: '9', codigo: 'PDV-9', numeroDia: 12, guardadoRevision: 3 })
    expect(r.lineas[0]).toMatchObject({ localId: 'a', precioLista: 25, precioMinimo: 22.5, precioGuardado: 24 })
    expect(r.lineas[1]).toMatchObject({ localId: 'b', precioMinimo: null, precioGuardado: 250, error: undefined })
  })
  it('ignora lo que dependa de las líneas si el vendedor cambió algo mientras viajaba la petición', () => {
    const l = local()
    const r = fusionarRespuesta(l, server(), 2)
    expect(r.numeroDia).toBe(12)
    expect(r.guardadoRevision).toBe(0)
    expect(r.lineas).toEqual(l.lineas)
  })
})

describe('pedidoDesdeServidor', () => {
  it('reconstruye líneas con ids locales nuevos y precio de base derivado', () => {
    let k = 0
    const p = pedidoDesdeServidor(server({ estado: 'ENVIADO' }), 'clave-1', () => `n${++k}`)
    expect(p).toMatchObject({ clave: 'clave-1', estado: 'ENVIADO', numeroDia: 12, revision: 0, guardadoRevision: 0 })
    expect(p.lineas.map((l) => l.localId)).toEqual(['n1', 'n2'])
    expect(p.lineas[1]).toMatchObject({ presentacionId: 3001, precioRetail: 25, factor: 10 })
    expect(p.lineas[0].presentacionId).toBeNull()
  })
})

describe('esErrorDeRed', () => {
  it('un error sin código de Postgres es de red; con código lo rechazó el servidor', () => {
    expect(esErrorDeRed(new Error('Failed to fetch'))).toBe(true)
    expect(esErrorDeRed(Object.assign(new Error('x'), { code: '' }))).toBe(true)
    expect(esErrorDeRed(Object.assign(new Error('x'), { code: '23514' }))).toBe(false)
    expect(esErrorDeRed(Object.assign(new Error('x'), { code: '42501' }))).toBe(false)
  })
})
