import { money, sumMoney, type Money } from '../common/money'
import type { Payment, PaymentAllocation, PaymentComponent } from './entities'

export const validateMixedPayment = (total: Money, components: PaymentComponent[]) => {
  if (components.length < 2) throw new Error('Un pago mixto requiere al menos dos componentes')
  if (components.some((component) => component.amount.cents <= 0)) throw new Error('Todos los componentes deben ser positivos')
  const paid = sumMoney(components.map((component) => component.amount), total.currency)
  if (paid.cents !== total.cents) throw new Error('La suma del pago mixto debe coincidir exactamente con el total')
  return paid
}

export const paymentSummary = (originalTotal: Money, allocations: PaymentAllocation[]) => {
  const paid = sumMoney(allocations.map((allocation) => allocation.amount), originalTotal.currency)
  if (paid.cents > originalTotal.cents) throw new Error('Los pagos aplicados exceden el total original')
  const pending = money(originalTotal.cents - paid.cents, originalTotal.currency)
  return { originalTotal, paid, pending, status: paid.cents === 0 ? 'pending_payment' : pending.cents === 0 ? 'paid' : 'partially_paid' as const }
}

export const assertPaymentIdempotency = (payments: Payment[], idempotencyKey: string) => {
  if (payments.some((payment) => payment.idempotencyKey === idempotencyKey)) throw new Error('Pago duplicado por clave de idempotencia')
}

