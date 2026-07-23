import { describe, expect, it } from 'vitest'
import { addMoney, applyPercentageDiscount, formatMoney, money, moneyFromDecimal, multiplyMoney, subtractMoney } from '../common/money'

describe('dinero', () => {
  it('convierte decimales a centavos sin error flotante', () => expect(moneyFromDecimal(18.5)).toEqual(money(1850)))
  it('suma, resta y multiplica montos', () => {
    expect(addMoney(money(100), money(250)).cents).toBe(350)
    expect(subtractMoney(money(350), money(50)).cents).toBe(300)
    expect(multiplyMoney(money(1850), 3).cents).toBe(5550)
  })
  it('aplica descuentos en puntos base y formatea', () => {
    expect(applyPercentageDiscount(money(1000), 1250).cents).toBe(875)
    expect(formatMoney(money(1850))).toContain('18,50')
  })
})

