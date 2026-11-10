import { describe, expect, it } from 'vitest'
import { asignarMonto, combinacionExacta, validarCobroPedidos, type FilaAsignable } from '../asignacionPedidos'

const fila = (clave: string, pendiente: number, partidas?: [number, number][]): FilaAsignable => ({
  clave, etiqueta: clave, pendiente, partidas: (partidas ?? [[Number(clave.replace(/\D/g, '')) || 1, pendiente]]).map(([partidaId, p]) => ({ partidaId, pendiente: p })),
})
// Caso real BNB: cuatro pedidos abiertos, el cliente pagó 3.690 para los dos más nuevos.
const bnb = [fila('PED-00597', 4600), fila('PED-00600', 4930), fila('PED-00802', 3620), fila('PED-00805', 70)]

describe('asignarMonto', () => {
  it('cada fila marcada toma min(pendiente, restante) en el orden de la lista', () => {
    const r = asignarMonto(5000, bnb, ['PED-00597', 'PED-00600'])
    expect(r.filas).toEqual([{ clave: 'PED-00597', seAplica: 4600 }, { clave: 'PED-00600', seAplica: 400 }])
    expect(r.aplicado).toBe(5000)
    expect(r.sobrante).toBe(0)
  })
  it('informa el sobrante cuando el monto supera lo marcado', () => {
    const r = asignarMonto(3700, bnb, ['PED-00802', 'PED-00805'])
    expect(r.aplicado).toBe(3690)
    expect(r.sobrante).toBe(10)
  })
  it('reparte dentro del pedido por partidas y la suma coincide exacto', () => {
    const f = [fila('P1', 100.1, [[1, 50.05], [2, 30.03], [3, 20.02]])]
    const r = asignarMonto(70.07, f, ['P1'])
    expect(r.aplicaciones).toEqual([{ partidaId: 1, monto: 50.05 }, { partidaId: 2, monto: 20.02 }])
    expect(r.aplicaciones.reduce((s, a) => Math.round(s * 100 + a.monto * 100) / 100, 0)).toBe(70.07)
  })
  it('no aplica nada a filas no marcadas', () => {
    expect(asignarMonto(100, bnb, []).aplicaciones).toEqual([])
  })
})

describe('combinacionExacta', () => {
  it('BNB: 3690 sugiere PED-00802 + PED-00805', () => {
    expect(combinacionExacta(3690, bnb)?.map(f => f.clave)).toEqual(['PED-00802', 'PED-00805'])
  })
  it('prefiere el conjunto más chico', () => {
    expect(combinacionExacta(70, [fila('A', 50), fila('B', 20), fila('C', 70)])?.map(f => f.clave)).toEqual(['C'])
  })
  it('en empate gana el más antiguo', () => {
    expect(combinacionExacta(100, [fila('A', 60), fila('B', 40), fila('C', 70), fila('D', 30)])?.map(f => f.clave)).toEqual(['A', 'B'])
  })
  it('devuelve null si nada suma exacto', () => {
    expect(combinacionExacta(1234, bnb)).toBeNull()
  })
  it('con más de 15 filas solo prueba individuales y pares', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => fila(`F${i}`, 10 + i))
    expect(combinacionExacta(43, muchas)?.map(f => f.clave)).toEqual(['F4', 'F19'])
    expect(combinacionExacta(100, muchas)).toBeNull()
  })
})

describe('validarCobroPedidos', () => {
  it('bloquea sin monto', () => {
    expect(validarCobroPedidos({ monto: 0, filas: bnb, marcadas: ['PED-00802'] })).toMatch(/monto/)
  })
  it('bloquea sin pedidos marcados', () => {
    expect(validarCobroPedidos({ monto: 100, filas: bnb, marcadas: [] })).toMatch(/Marca/)
  })
  it('bloquea cuando sobra dinero y quedan pedidos sin marcar', () => {
    const msg = validarCobroPedidos({ monto: 5000, filas: bnb, marcadas: ['PED-00802'] })
    expect(msg).toMatch(/Sobran Bs 1\.380,00|Sobran Bs 1380,00/)
  })
  it('permite el cobro exacto y el sobrante cuando todo está marcado', () => {
    expect(validarCobroPedidos({ monto: 3690, filas: bnb, marcadas: ['PED-00802', 'PED-00805'] })).toBeNull()
    expect(validarCobroPedidos({ monto: 99999, filas: bnb, marcadas: bnb.map(f => f.clave) })).toBeNull()
  })
})
