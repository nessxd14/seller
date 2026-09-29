import { describe, expect, it } from 'vitest'
import { buildPrecioSugeridoView } from './PrecioSugeridoHint'
import type { PrecioSugerido } from '../../infrastructure/supabase/PreciosRepository.supabase'

const sugeridoBase: PrecioSugerido = {
  factor: 10,
  ultimoCliente: { precio: 38, fecha: '2026-09-25', numero: 'PED-2026-00569', fuente: 'PEDIDO' },
  categoria: { categoria: 'CORPORATIVO', mediana: 38, lineas: 4, dias: 90 },
}

describe('buildPrecioSugeridoView', () => {
  it('devuelve null si no hay ni último ni mediana de categoría', () => {
    expect(buildPrecioSugeridoView({ factor: 1, ultimoCliente: null, categoria: null }, 3800)).toBeNull()
    expect(buildPrecioSugeridoView(null, 3800)).toBeNull()
    expect(buildPrecioSugeridoView(undefined, 3800)).toBeNull()
  })

  it('arma el texto de "último a este cliente" para un pedido', () => {
    const view = buildPrecioSugeridoView(sugeridoBase, 3800)
    expect(view?.ultimoLabel).toBe('Último a este cliente')
    expect(view?.ultimoPrecioBs).toBe(38)
    expect(view?.ultimoNumero).toBe('PED-2026-00569')
  })

  it('cambia la etiqueta cuando el último precio viene de una cotización', () => {
    const view = buildPrecioSugeridoView({ ...sugeridoBase, ultimoCliente: { ...sugeridoBase.ultimoCliente!, fuente: 'COTIZACION' } }, 3800)
    expect(view?.ultimoLabel).toBe('Última cotización a este cliente')
  })

  it('arma el texto de mediana de categoría', () => {
    const view = buildPrecioSugeridoView(sugeridoBase, 3800)
    expect(view?.categoriaLabel).toBe('Corporativo')
    expect(view?.categoriaPrecioBs).toBe(38)
    expect(view?.categoriaLineas).toBe(4)
  })

  it('funciona con solo mediana de categoría (cliente de mostrador, sin clienteId)', () => {
    const view = buildPrecioSugeridoView({ factor: 1, ultimoCliente: null, categoria: sugeridoBase.categoria }, 3800)
    expect(view?.ultimoPrecioBs).toBeNull()
    expect(view?.categoriaPrecioBs).toBe(38)
  })

  it('marca "distinto al último" cuando el precio actual difiere más de 5%', () => {
    const view = buildPrecioSugeridoView(sugeridoBase, 5000) // Bs 50 vs último Bs 38 -> +31.6%
    expect(view?.distintoChip).toBe('Distinto al último (Bs 38,00)')
  })

  it('no marca "distinto" dentro del 5%', () => {
    const view = buildPrecioSugeridoView(sugeridoBase, 3900) // Bs 39 vs Bs 38 -> +2.6%
    expect(view?.distintoChip).toBeNull()
  })

  it('no marca "distinto" cuando no hay último cliente contra qué comparar', () => {
    const view = buildPrecioSugeridoView({ factor: 1, ultimoCliente: null, categoria: sugeridoBase.categoria }, 100000)
    expect(view?.distintoChip).toBeNull()
  })
})
