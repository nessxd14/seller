import { applyPercentageDiscount, money, moneyFromDecimal, moneyToDecimal, multiplyMoney, sumMoney } from '../common/money'

export interface CartCalculationLine { unitPrice: number; quantity: number; discountPercent: number }

export const calculateLineTotal = (line: CartCalculationLine) => {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new Error('Cantidad inválida')
  const discountBasisPoints = Math.round(Math.min(100, Math.max(0, line.discountPercent)) * 100)
  return applyPercentageDiscount(multiplyMoney(moneyFromDecimal(Math.max(0, line.unitPrice)), line.quantity), discountBasisPoints)
}

export const calculateCartTotals = (lines: CartCalculationLine[], generalDiscount: number) => {
  const subtotal = sumMoney(lines.map(calculateLineTotal))
  const discount = money(Math.min(subtotal.cents, Math.max(0, moneyFromDecimal(generalDiscount).cents)))
  const total = money(subtotal.cents - discount.cents)
  return { subtotal, discount, total, subtotalDecimal: moneyToDecimal(subtotal), discountDecimal: moneyToDecimal(discount), totalDecimal: moneyToDecimal(total) }
}

