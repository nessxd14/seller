import type { LocalRepository } from '../../infrastructure/mock/localStore'
import type { CashSessionRecord } from '../shared/models'

export class CashService {
  constructor(private readonly repository: LocalRepository<CashSessionRecord>) {}
  list() { return this.repository.list() }
  async open(register: string, openingCents: number) {
    if (openingCents < 0) throw new Error('El monto inicial no puede ser negativo')
    if ((await this.repository.list()).some((session) => session.register === register && session.status === 'open')) throw new Error('La caja ya tiene una sesión abierta')
    return this.repository.save({ id: crypto.randomUUID(), register, openedAt: new Date().toISOString(), openingCents, status: 'open', movements: [] })
  }
  expected(session: CashSessionRecord) { return session.openingCents + session.movements.reduce((sum, movement) => sum + (movement.type === 'income' ? movement.amountCents : -movement.amountCents), 0) }
  async addMovement(session: CashSessionRecord, type: 'income' | 'expense', amountCents: number, note: string) {
    if (session.status !== 'open') throw new Error('La sesión está cerrada')
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Monto inválido')
    return this.repository.save({ ...session, movements: [...session.movements, { id: crypto.randomUUID(), type, method: 'cash', amountCents, note: note || (type === 'income' ? 'Ingreso manual mock' : 'Egreso manual mock'), at: new Date().toISOString() }] })
  }
  async close(session: CashSessionRecord, countedCents: number) {
    if (session.status !== 'open') throw new Error('La sesión ya está cerrada')
    return this.repository.save({ ...session, status: 'closed', countedCents, closedAt: new Date().toISOString() })
  }
}
