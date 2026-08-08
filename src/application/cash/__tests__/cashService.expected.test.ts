import { describe, expect, it } from 'vitest'
import { expectedCash } from '../CashService'
import type { CashSessionRecord } from '../../shared/models'

const session = (openingCents: number, movements: CashSessionRecord['movements']): CashSessionRecord => ({
  id: 's1',
  register: 'Caja Tienda',
  openedAt: '2026-08-08T12:00:00Z',
  openingCents,
  status: 'open',
  movements,
})

const mov = (type: 'income' | 'expense', method: 'cash' | 'qr' | 'transfer', amountCents: number) =>
  ({ id: crypto.randomUUID(), type, method, amountCents, note: '', at: '2026-08-08T12:00:00Z' })

describe('CashService.expected — solo efectivo entra al cajón', () => {
  it('suma solo movimientos en efectivo', () => {
    const s = session(50000, [mov('income', 'cash', 20000)])
    expect(expectedCash(s)).toBe(70000)
  })

  it('ignora QR y transferencia mezclados con efectivo', () => {
    const s = session(50000, [mov('income', 'cash', 20000), mov('income', 'qr', 300000), mov('income', 'transfer', 100000)])
    expect(expectedCash(s)).toBe(70000)
  })

  it('resta egresos en efectivo', () => {
    const s = session(50000, [mov('income', 'cash', 20000), mov('expense', 'cash', 5000)])
    expect(expectedCash(s)).toBe(65000)
  })

  it('no resta egresos en QR', () => {
    const s = session(50000, [mov('income', 'cash', 20000), mov('expense', 'qr', 5000)])
    expect(expectedCash(s)).toBe(70000)
  })

  it('sesión sin movimientos devuelve la apertura', () => {
    const s = session(50000, [])
    expect(expectedCash(s)).toBe(50000)
  })

  it('caso del criterio de aceptación: apertura 500, venta efectivo 200, venta QR 3000, egreso efectivo 50 → 650', () => {
    const s = session(50000, [mov('income', 'cash', 20000), mov('income', 'qr', 300000), mov('expense', 'cash', 5000)])
    expect(expectedCash(s)).toBe(65000)
  })
})
