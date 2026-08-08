import type { LocalRepository } from '../../infrastructure/mock/localStore'
import type { CashSessionRecord } from '../shared/models'

/**
 * Efectivo esperado en el cajón: apertura + movimientos EN EFECTIVO (nunca QR ni
 * transferencia, esos no pasan por el cajón). Única fórmula del repo — tanto el mock
 * (CashService.expected) como el adaptador de Supabase (infrastructure/supabase/services.ts)
 * delegan acá para que no vuelvan a divergir.
 */
export function expectedCash(session: CashSessionRecord) {
  return session.openingCents + session.movements
    .filter((movement) => movement.method === 'cash')
    .reduce((sum, movement) => sum + (movement.type === 'income' ? movement.amountCents : -movement.amountCents), 0)
}

export class CashService {
  constructor(private readonly repository: LocalRepository<CashSessionRecord>) {}
  list() { return this.repository.list() }
  async open(register: string, openingCents: number) {
    if (openingCents < 0) throw new Error('El monto inicial no puede ser negativo')
    if ((await this.repository.list()).some((session) => session.register === register && session.status === 'open')) throw new Error('La caja ya tiene una sesión abierta')
    return this.repository.save({ id: crypto.randomUUID(), register, openedAt: new Date().toISOString(), openingCents, status: 'open', movements: [] })
  }
  expected(session: CashSessionRecord) {
    return expectedCash(session)
  }
  async addMovement(session: CashSessionRecord, type: 'income' | 'expense', amountCents: number, note: string, method: 'cash' | 'qr' | 'transfer' = 'cash') {
    if (session.status !== 'open') throw new Error('La sesión está cerrada')
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Monto inválido')
    return this.repository.save({ ...session, movements: [...session.movements, { id: crypto.randomUUID(), type, method, amountCents, note: note || (type === 'income' ? 'Ingreso manual mock' : 'Egreso manual mock'), at: new Date().toISOString() }] })
  }
  async close(session: CashSessionRecord, countedCents: number) {
    if (session.status !== 'open') throw new Error('La sesión ya está cerrada')
    return this.repository.save({ ...session, status: 'closed', countedCents, closedAt: new Date().toISOString() })
  }
}
