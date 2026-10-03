// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { QuoteDraft } from '../../../application/shared/models'
const { save, getById, list } = vi.hoisted(() => ({save:vi.fn(),getById:vi.fn(),list:vi.fn()}))
vi.mock('../QuoteRepository.supabase', () => ({quoteRepository:{save,getById,list}}))
vi.mock('../SupabaseAuthSessionProvider', () => ({supabaseAuthSessionProvider:{getSession:vi.fn().mockResolvedValue(null)}}))
import { quoteService } from '../services'

describe('quoteService — versión de la edición', () => {
  it('incluye cotizaciones anteriores a las primeras 200 sin truncar la lista', async () => {
    list.mockImplementation(async ({page}:{page:{page:number;pageSize:number}}) => ({
      items:Array.from({length:page.page < 3 ? 200 : 22},(_,index) => ({id:String((page.page-1)*200+index+1)})),
      total:422,
    }))
    const result = await quoteService.list()
    expect(result).toHaveLength(422)
    expect(result[421].id).toBe('422')
    expect(list).toHaveBeenCalledTimes(3)
  })
  it('manda la versión que leyó el vendedor sin sustituirla por una lectura más reciente', async () => {
    const quote:QuoteDraft = {id:'42',version:2,number:'COT-42',customerId:'1',customerName:'Cliente',
      channel:'mayoreo',status:'draft',validUntil:'',terms:'',notes:'',generalDiscountCents:0,createdAt:'',lines:[]}
    getById.mockResolvedValue({...quote,version:3})
    await quoteService.save(quote)
    expect(save).toHaveBeenCalledWith(quote,{actorId:'pos',expectedVersion:2})
    expect(getById).not.toHaveBeenCalled()
  })
})
