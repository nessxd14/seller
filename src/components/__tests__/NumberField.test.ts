import { describe, expect, it } from 'vitest'
import { resolveNumberFieldCommit } from '../NumberField'

// El proyecto no tiene jsdom/@testing-library configurado (ningún test existente
// monta un componente), así que esto testea la lógica de confirmación en forma
// pura en vez de simular tipeo sobre un <input> real. La pieza que evita el
// "no me deja escribir" del antipatrón original es estructural, no algo que este
// test pueda ejercitar por DOM: NumberField.onChange SOLO llama setText(texto
// crudo) — nunca resolveNumberFieldCommit — así que ningún estado intermedio
// mientras se escribe (vacío, "12.", "0") pasa nunca por clamp/parseo. Acá se
// prueba exactamente esa función de confirmación: qué pasa al perder foco o
// apretar Enter, que es donde el arreglo realmente importa.
describe('resolveNumberFieldCommit', () => {
  it('revierte al último valor válido si el texto queda vacío (nunca al mínimo)', () => {
    expect(resolveNumberFieldCommit('', 5, { min: 1 })).toBe(5)
  })

  it('revierte al último valor válido si el texto no es un número', () => {
    expect(resolveNumberFieldCommit('abc', 12, { min: 0 })).toBe(12)
  })

  it('acepta decimales', () => {
    expect(resolveNumberFieldCommit('12.5', 0, { allowDecimals: true })).toBe(12.5)
  })

  it('trunca a entero cuando allowDecimals es false (cantidades)', () => {
    expect(resolveNumberFieldCommit('12.9', 1, { allowDecimals: false })).toBe(12)
  })

  it('aplica el mínimo en el commit, no mientras se escribe', () => {
    expect(resolveNumberFieldCommit('0', 1, { min: 1 })).toBe(1)
  })

  it('aplica el máximo en el commit', () => {
    expect(resolveNumberFieldCommit('999', 1, { max: 100 })).toBe(100)
  })

  it('un número tipeado con punto decimal final se confirma sin perder dígitos previos', () => {
    // "12." nunca llega a resolveNumberFieldCommit mientras se escribe (eso es lo
    // que arregla NumberField) — cuando SÍ se confirma, ya terminó de escribirse
    // ("12.5") y se parsea entero.
    expect(resolveNumberFieldCommit('12.5', 0)).toBe(12.5)
  })

  it('respeta un valor negativo válido cuando no hay mínimo', () => {
    expect(resolveNumberFieldCommit('-3', 0)).toBe(-3)
  })
})
