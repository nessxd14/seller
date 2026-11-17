import { describe, expect, it } from 'vitest'
import { proximoCorte, turnoTerminoSolo } from '../turnoPiso'

// La Paz es UTC−4 todo el año.
const laPaz = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00-04:00`)

describe('proximoCorte (America/La_Paz)', () => {
  it.each([
    ['06:00', '14:00'], ['13:59', '14:00'], ['14:00', '21:30'], ['21:29', '21:30'], ['21:30', null], ['23:59', null],
  ])('a las %s → %s', (hora, esperado) => expect(proximoCorte(laPaz(hora))).toBe(esperado))

  it('usa la hora de La Paz aunque el teléfono esté en otra zona', () => {
    expect(proximoCorte(new Date('2026-11-16T17:59:00Z'))).toBe('14:00')
    expect(proximoCorte(new Date('2026-11-16T18:00:00Z'))).toBe('21:30')
  })
})

describe('turnoTerminoSolo', () => {
  const ultimo = (cierre: 'MANUAL' | 'AUTOMATICO' | 'GERENTE' | 'CAJA') => ({ turnoId: 1, inicio: 'a', fin: 'b', cierre })
  it('solo AUTOMATICO y CAJA', () => {
    expect(turnoTerminoSolo(ultimo('AUTOMATICO'))).toBe(true)
    expect(turnoTerminoSolo(ultimo('CAJA'))).toBe(true)
    expect(turnoTerminoSolo(ultimo('MANUAL'))).toBe(false)
    expect(turnoTerminoSolo(ultimo('GERENTE'))).toBe(false)
    expect(turnoTerminoSolo(null)).toBe(false)
  })
})
