export type Currency = 'BOB'

export interface Money {
  readonly cents: number
  readonly currency: Currency
}

const assertInteger = (value: number) => {
  if (!Number.isSafeInteger(value)) throw new Error('El monto debe expresarse en centavos enteros seguros')
}

export const money = (cents: number, currency: Currency = 'BOB'): Money => {
  assertInteger(cents)
  return { cents, currency }
}

export const moneyFromDecimal = (value: number): Money => {
  if (!Number.isFinite(value)) throw new Error('Monto inválido')
  return money(Math.round((value + Number.EPSILON) * 100))
}

export const moneyToDecimal = (value: Money) => value.cents / 100

const sameCurrency = (a: Money, b: Money) => {
  if (a.currency !== b.currency) throw new Error('Las monedas no coinciden')
}

export const addMoney = (a: Money, b: Money): Money => { sameCurrency(a, b); return money(a.cents + b.cents, a.currency) }
export const subtractMoney = (a: Money, b: Money): Money => { sameCurrency(a, b); return money(a.cents - b.cents, a.currency) }
export const multiplyMoney = (unitPrice: Money, quantity: number): Money => {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error('Cantidad inválida')
  return money(unitPrice.cents * quantity, unitPrice.currency)
}
export const applyPercentageDiscount = (amount: Money, basisPoints: number): Money => {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new Error('Descuento fuera de rango')
  return money(Math.round(amount.cents * (10_000 - basisPoints) / 10_000), amount.currency)
}
export const sumMoney = (values: Money[], currency: Currency = 'BOB') => values.reduce((total, value) => addMoney(total, value), money(0, currency))
export const formatMoney = (value: Money) => `Bs ${moneyToDecimal(value).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

