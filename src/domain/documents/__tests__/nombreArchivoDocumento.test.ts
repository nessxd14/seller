import { describe, expect, it } from 'vitest'
import { nombreArchivoDocumento, sanitizarParaArchivo } from '../nombreArchivoDocumento'

describe('nombreArchivoDocumento', () => {
  it('formato del brief: número - cliente', () => {
    expect(nombreArchivoDocumento('PED-2026-00123', 'Ferreteria Los Andes')).toBe('PED-2026-00123 - Ferreteria Los Andes')
  })

  it('sin cliente: solo el número', () => {
    expect(nombreArchivoDocumento('PED-2026-00123')).toBe('PED-2026-00123')
    expect(nombreArchivoDocumento('PED-2026-00123', '')).toBe('PED-2026-00123')
  })

  it('cliente en blanco (solo espacios): trata como sin cliente', () => {
    expect(nombreArchivoDocumento('PED-2026-00123', '   ')).toBe('PED-2026-00123')
  })
})

describe('sanitizarParaArchivo', () => {
  it('quita acentos', () => {
    expect(sanitizarParaArchivo('Ferretería Peña')).toBe('Ferreteria Pena')
  })

  it('quita caracteres ilegales de nombre de archivo', () => {
    expect(sanitizarParaArchivo('A/B\\C:D*E?F"G<H>I|J')).toBe('ABCDEFGHIJ')
  })

  it('colapsa espacios múltiples y recorta extremos', () => {
    expect(sanitizarParaArchivo('  Cliente   con    espacios  ')).toBe('Cliente con espacios')
  })

  it('trunca a 60 caracteres', () => {
    const largo = 'C'.repeat(80)
    const resultado = sanitizarParaArchivo(largo)
    expect(resultado).toHaveLength(60)
  })

  it('combina todas las reglas juntas', () => {
    expect(sanitizarParaArchivo('  Ferretería "Los Andes" / Sucursal Norte  ')).toBe('Ferreteria Los Andes Sucursal Norte')
  })
})
