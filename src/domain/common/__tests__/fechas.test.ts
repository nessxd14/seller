import { afterEach, describe, expect, it, vi } from 'vitest'
import { hoyLocal, sumarDiasIso } from '../fechas'

describe('hoyLocal — Bolivia es UTC−4, nunca la fecha de mañana antes de tiempo', () => {
  afterEach(() => { vi.useRealTimers() })

  it('19:30 hora local (23:30 UTC) sigue siendo el 8', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-08T23:30:00Z'))
    expect(hoyLocal()).toBe('2026-08-08')
  })

  it('21:30 del 8 hora local (01:30 UTC del 9) todavía es el 8 — el caso que todayIso rompía', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-09T01:30:00Z'))
    expect(hoyLocal()).toBe('2026-08-08')
  })
})

describe('sumarDiasIso', () => {
  it('suma días dentro del mismo mes', () => {
    expect(sumarDiasIso('2026-08-08', 15)).toBe('2026-08-23')
  })

  it('resta días cruzando el mes', () => {
    expect(sumarDiasIso('2026-08-08', -30)).toBe('2026-07-09')
  })

  it('suma días cruzando el año', () => {
    expect(sumarDiasIso('2026-12-25', 15)).toBe('2027-01-09')
  })
})
