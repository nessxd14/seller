import type { CustomerRecord } from '../../application/shared/models'
import type { PosPaymentMethodExt } from '../../infrastructure/supabase/mappers'
import type { CobroDestino } from '../../components/useCobroDestino'

export interface PaymentAttempt {
  operationId: string
  customer: CustomerRecord
  orderId?: string
  amountCents: number
  method: PosPaymentMethodExt
  sessionId: string
  noImputar: boolean
  aplicaciones?: { partidaId: number; monto: number }[]
  destino: CobroDestino | null
  referencia: string
}
export const paymentAttemptKey = (actorId: string) => `cation-pago-pendiente:${actorId}`
export function readPaymentAttempt(actorId: string): PaymentAttempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(paymentAttemptKey(actorId)) ?? 'null') as PaymentAttempt | null
    return value && typeof value.operationId === 'string' && typeof value.customer?.id === 'string'
      && typeof value.sessionId === 'string' && Number.isSafeInteger(value.amountCents) && value.amountCents > 0
      && ['cash','qr','deposit','transfer','sigep','check'].includes(value.method) ? value : null
  } catch { return null }
}
export const paymentRejected = (error: unknown) => /^(P0001|42501|22\w{3}|23\w{3}|PGRST202)$/.test(String((error as { code?: string })?.code ?? ''))
