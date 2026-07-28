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
  // TAREA 2 (Ronda 9) — anular/restaurar con bitácora. Decisión confirmada con Ness:
  // solo se pueden anular pedidos sin líneas despachadas (camino (a) del brief).
  async cancel(id: string, motivo: string, actorId: string) {
    const order = await this.repository.get(id)
    if (!order) throw new Error('Pedido no encontrado')
    if (order.status === 'cancelled') throw new Error('El pedido ya está anulado')
    if (order.lines.some((line) => line.prepared > 0)) throw new Error('No se puede anular: tiene líneas ya despachadas')
    const updated = {
      ...order,
      status: 'cancelled' as const,
      previousStatus: order.status,
      events: [...order.events, { at: new Date().toLocaleString('es-BO'), label: 'Pedido anulado', detail: `${actorId} · ${motivo}` }],
    }
    return this.repository.save(updated)
  }
  async restore(id: string, motivo: string, actorId: string) {
    const order = await this.repository.get(id)
    if (!order) throw new Error('Pedido no encontrado')
    if (order.status !== 'cancelled') throw new Error('El pedido no está anulado')
    const updated = {
      ...order,
      status: order.previousStatus ?? 'confirmed',
      previousStatus: undefined,
      events: [...order.events, { at: new Date().toLocaleString('es-BO'), label: 'Pedido restaurado', detail: `${actorId} · ${motivo}` }],
    }
    return this.repository.save(updated)
  }
}

