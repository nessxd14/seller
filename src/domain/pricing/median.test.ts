import { describe, expect, it } from 'vitest'
import { median, rollingMedian } from './median'

describe('median', () => {
  it('devuelve null para una lista vacía', () => {
    expect(median([])).toBeNull()
  })
  it('el del medio para una lista de tamaño impar', () => {
    expect(median([3, 1, 2])).toBe(2)
  })
  it('el promedio de los dos del medio para una lista de tamaño par', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('no muta el array de entrada', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })
})

describe('rollingMedian', () => {
  it('devuelve un punto por cada punto de entrada, ordenados por x', () => {
    const points = [{ x: 3, y: 30 }, { x: 1, y: 10 }, { x: 2, y: 20 }]
    const result = rollingMedian(points, 7)
    expect(result.map((p) => p.x)).toEqual([1, 2, 3])
  })
  it('con una ventana mayor que los datos, converge a la mediana global', () => {
    const points = [1, 2, 3, 4, 5].map((x) => ({ x, y: x * 10 }))
    const result = rollingMedian(points, 100)
    expect(result.at(-1)?.y).toBe(30) // mediana de 10..50
  })
  it('con ventana 1, cada punto es su propio valor (línea = los datos)', () => {
    const points = [{ x: 1, y: 5 }, { x: 2, y: 99 }]
    const result = rollingMedian(points, 1)
    expect(result).toEqual([{ x: 1, y: 5 }, { x: 2, y: 99 }])
  })
  it('un outlier puntual no arrastra la mediana del vecino en una ventana de 7', () => {
    const points = [10, 10, 10, 500, 10, 10, 10].map((y, i) => ({ x: i, y }))
    const result = rollingMedian(points, 7)
    expect(result.at(-1)?.y).toBe(10)
  })
  it('rechaza windowSize < 1', () => {
    expect(() => rollingMedian([{ x: 1, y: 1 }], 0)).toThrow()
  })
})
