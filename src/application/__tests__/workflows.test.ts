import { describe, expect, it } from 'vitest'
import { QuoteService } from '../quotations/QuoteService'
import { OrderService } from '../orders/OrderService'
import { CashService } from '../cash/CashService'
import type { LocalRepository } from '../../infrastructure/mock/localStore'
import type { CashSessionRecord, OrderView, QuoteDraft } from '../shared/models'
import { printLabels } from '../printing/PrintService'

class MemoryRepository<T extends { id: string }> implements LocalRepository<T> {
  constructor(private values: T[] = []) {}
  async list() { return structuredClone(this.values) }
  async get(id: string) { return structuredClone(this.values.find((item) => item.id === id) ?? null) }
  async save(value: T) { const index=this.values.findIndex((item)=>item.id===value.id); if(index>=0)this.values[index]=structuredClone(value); else this.values.push(structuredClone(value)); return value }
  async remove(id: string) { this.values=this.values.filter((item)=>item.id!==id) }
}

const quote = (status: QuoteDraft['status'] = 'draft'): QuoteDraft => ({ id:'q1',number:'COT-1',customerId:'c1',customerName:'Colegio',channel:'institucional',status,validUntil:'2026-08-01',terms:'Contado',notes:'Snapshot',generalDiscountCents:0,createdAt:'2026-07-23',lines:[{id:'l1',productId:'p1',name:'Cuaderno',sku:'CU-1',quantity:10,unitPriceCents:1500,discountBasisPoints:0}] })

describe('flujos frontend mock', () => {
  it('crea y edita una cotización borrador', async () => {
    const repository=new MemoryRepository<QuoteDraft>()
    const service=new QuoteService(repository)
    await service.save(quote())
    await service.save({...quote(),notes:'Editada'})
    expect((await service.list())[0].notes).toBe('Editada')
  })
  it('impide editar una cotización convertida', async () => {
    const service=new QuoteService(new MemoryRepository([quote('converted')]))
    await expect(service.save({...quote('converted'),notes:'Cambio'})).rejects.toThrow('no puede editarse')
  })
  it('convierte aprobada conservando snapshots', async () => {
    const service=new QuoteService(new MemoryRepository([quote('approved')]))
    const order=await service.markConverted('q1','o1')
    expect(order.items[0].product.name).toBe('Cuaderno')
    expect(order.terms.notes).toBe('Snapshot')
    expect((await service.list())[0].status).toBe('converted')
  })
  it('registra despacho parcial sin movimiento real', async () => {
    const order:OrderView={id:'o1',number:'P-1',customerName:'Cliente',channel:'mayoreo',status:'preparing',createdAt:'2026-07-23',lines:[{...quote().lines[0],prepared:6,allocations:[{location:'Almacén',quantity:6},{location:'Tienda',quantity:4}]}],events:[]}
    const service=new OrderService(new MemoryRepository([order]))
    const result=await service.partialDispatch('o1')
    expect(result.status).toBe('dispatched')
    expect(result.events[0].detail).toContain('6 unidades')
  })
  it('calcula cierre con sobrante y faltante', async () => {
    const service=new CashService(new MemoryRepository<CashSessionRecord>())
    const session=await service.open('Caja 01',50000)
    expect(51000-service.expected(session)).toBe(1000)
    expect(49000-service.expected(session)).toBe(-1000)
  })
  it('incluye plantillas térmicas y A4', () => {
    expect(printLabels['ticket-58']).toContain('58 mm')
    expect(printLabels['ticket-80']).toContain('80 mm')
    expect(printLabels['quote-a4']).toContain('A4')
    expect(printLabels['traslado-a4']).toContain('A4')
  })
})

