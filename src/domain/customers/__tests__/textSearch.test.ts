import { describe, expect, it } from 'vitest'
import { coincideBusqueda, normalizarBusqueda } from '../textSearch'

describe('normalizarBusqueda — sin acentos, sin mayúsculas', () => {
  it('quita acentos', () => {
    expect(normalizarBusqueda('José Pérez')).toBe('jose perez')
  })

  it('recorta espacios en los extremos', () => {
    expect(normalizarBusqueda('  Ferretería  ')).toBe('ferretería'.normalize('NFD').replace(/[̀-ͯ]/g, ''))
  })
})

describe('coincideBusqueda — buscar "jose perez" encuentra "José Pérez"', () => {
  it('encuentra por nombre sin acentos ni mayúsculas', () => {
    expect(coincideBusqueda('José Pérez', 'jose perez')).toBe(true)
    expect(coincideBusqueda('José Pérez', 'JOSE PEREZ')).toBe(true)
  })

  it('encuentra por coincidencia parcial', () => {
    expect(coincideBusqueda('Ferretería Los Andes S.R.L.', 'los andes')).toBe(true)
  })

  it('no encuentra lo que no coincide', () => {
    expect(coincideBusqueda('José Pérez', 'maria gomez')).toBe(false)
  })

  it('query vacío coincide con todo', () => {
    expect(coincideBusqueda('Cualquier cosa', '')).toBe(true)
    expect(coincideBusqueda('Cualquier cosa', '   ')).toBe(true)
  })
})
