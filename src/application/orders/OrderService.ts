import type { LocalRepository } from '../../infrastructure/mock/localStore'
import type { OrderView } from '../shared/models'

export class OrderService {
  constructor(private readonly repository: LocalRepository<OrderView>) {}
  list() { return this.repository.list() }
  save(order: OrderView) { return this.repository.save(order) }
  async partialDispatch(id: string) {
    const order = await this.repository.get(id)
    if (!order || !['preparing', 'ready'].includes(order.status)) throw new Error('El pedido no admite despacho')
    const dispatched = order.lines.reduce((sum, line) => sum + line.prepared, 0)
    const updated = { ...order, status: 'dispatched' as const, events: [...order.events, { at: new Date().toLocaleString('es-BO'), label: 'Despacho parcial simulado', detail: `${dispatched} unidades despachadas sin movimiento real` }] }
    return this.repository.save(updated)
  }
}

