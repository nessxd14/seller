import { describe, expect, it } from 'vitest'
import { nombreArchivoDocumento } from '../nombreArchivoDocumento'

describe('nombreArchivoDocumento — nombre de archivo para document.title al imprimir', () => {
  it('número y cliente: "numero - cliente"', () => {
    expect(nombreArchivoDocumento('PED-2026-00123', 'Ferreteria Los Andes')).toBe('PED-2026-00123 - Ferreteria Los Andes')
  })

  it('sin cliente: solo el número', () => {
    expect(nombreArchivoDocumento('PED-2026-00123')).toBe('PED-2026-00123')
    expect(nombreArchivoDocumento('PED-2026-00123', '')).toBe('PED-2026-00123')
  })

  it('quita acentos', () => {
    expect(nombreArchivoDocumento('COT-1', 'Ferretería José Núñez')).toBe('COT-1 - Ferreteria Jose Nunez')
  })

  it('quita caracteres prohibidos en nombres de archivo', () => {
    expect(nombreArchivoDocumento('COT-1', 'A/B\\C:D*E?F"G<H>I|J')).toBe('COT-1 - ABCDEFGHIJ')
  })

  it('colapsa espacios múltiples y recorta extremos', () => {
    expect(nombreArchivoDocumento('COT-1', '  Cliente   Con   Espacios  ')).toBe('COT-1 - Cliente Con Espacios')
  })

  it('trunca el nombre del cliente a 60 caracteres', () => {
    const clienteLargo = 'A'.repeat(80)
    const resultado = nombreArchivoDocumento('COT-1', clienteLargo)
    expect(resultado).toBe(`COT-1 - ${'A'.repeat(60)}`)
  })

  it('cliente que queda vacío tras sanitizar (solo caracteres prohibidos): se comporta como sin cliente', () => {
    expect(nombreArchivoDocumento('COT-1', '///')).toBe('COT-1')
  })
})
