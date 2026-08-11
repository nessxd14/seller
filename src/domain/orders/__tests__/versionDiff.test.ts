import { describe, expect, it } from 'vitest'
import { diffVersionLines, type VersionDiffLine } from '../versionDiff'

const line = (overrides: Partial<VersionDiffLine> = {}): VersionDiffLine => ({
  lineaId: 1,
  cantidadBase: 10,
  precioUnitario: 100,
  ...overrides,
})

describe('diffVersionLines — comparación entre versiones de un pedido', () => {
  it('sin versión anterior (versión 1): todas las líneas son "added"', () => {
    const actual = [line({ lineaId: 1 }), line({ lineaId: 2 })]
    const diff = diffVersionLines(undefined, actual)
    expect(diff.get(1)).toEqual({ lineaId: 1, kind: 'added', cantidadCambio: false, precioCambio: false })
    expect(diff.get(2)).toEqual({ lineaId: 2, kind: 'added', cantidadCambio: false, precioCambio: false })
  })

  it('línea agregada: está en actual pero no en anterior', () => {
    const anterior = [line({ lineaId: 1 })]
    const actual = [line({ lineaId: 1 }), line({ lineaId: 2 })]
    const diff = diffVersionLines(anterior, actual)
    expect(diff.get(2)?.kind).toBe('added')
  })

  it('línea quitada: estaba en anterior y ya no está en actual', () => {
    const anterior = [line({ lineaId: 1 }), line({ lineaId: 2 })]
    const actual = [line({ lineaId: 1 })]
    const diff = diffVersionLines(anterior, actual)
    expect(diff.get(2)).toEqual({ lineaId: 2, kind: 'removed', cantidadCambio: false, precioCambio: false })
  })

  it('cambio de cantidad: misma línea, cantidadBase distinta', () => {
    const anterior = [line({ lineaId: 1, cantidadBase: 10 })]
    const actual = [line({ lineaId: 1, cantidadBase: 15 })]
    const diff = diffVersionLines(anterior, actual)
    expect(diff.get(1)).toEqual({ lineaId: 1, kind: 'changed', cantidadCambio: true, precioCambio: false })
  })

  it('cambio de precio: misma línea, precioUnitario distinto', () => {
    const anterior = [line({ lineaId: 1, precioUnitario: 100 })]
    const actual = [line({ lineaId: 1, precioUnitario: 120 })]
    const diff = diffVersionLines(anterior, actual)
    expect(diff.get(1)).toEqual({ lineaId: 1, kind: 'changed', cantidadCambio: false, precioCambio: true })
  })

  it('línea sin cambios: se marca "unchanged"', () => {
    const anterior = [line({ lineaId: 1, cantidadBase: 10, precioUnitario: 100 })]
    const actual = [line({ lineaId: 1, cantidadBase: 10, precioUnitario: 100 })]
    const diff = diffVersionLines(anterior, actual)
    expect(diff.get(1)).toEqual({ lineaId: 1, kind: 'unchanged', cantidadCambio: false, precioCambio: false })
  })
})
