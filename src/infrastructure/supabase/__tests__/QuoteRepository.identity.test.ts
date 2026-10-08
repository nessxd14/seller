import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../application/errors/AppError'
import type { QuoteDraft } from '../../../application/shared/models'

const { fromMock, rpcMock } = vi.hoisted(() => ({fromMock:vi.fn(),rpcMock:vi.fn()}))
vi.mock('../supabaseClient',() => ({supabase:{from:(...args:unknown[]) => fromMock(...args),rpc:(...args:unknown[]) => rpcMock(...args)}}))
import { SupabaseQuoteRepository } from '../QuoteRepository.supabase'

const sourceHeader = {
  id:42,numero:'COT-42',cliente_id:1,cliente:{nombre:'Institución A'},categoria:'INSTITUCIONAL',referencia:null,
  estado:'BORRADOR',subtotal:35,descuento_general:0,total:35,notas:'Entrega de lunes a viernes',condiciones_comerciales:'Entrega en 72 horas',
  vigencia_hasta:'2026-10-20',version:3,creado_por:'original@test',creado_en:'2026-10-01',actualizado_en:'2026-10-02',
  asunto:'Material',condicion_pago:'CREDITO',medio_pago:'TRANSFERENCIA',fecha:'2026-10-01',
  solicitante_id:12,solicitado_por:'Nombre histórico',
}
const sourceLines = [{id:10,cotizacion_id:42,es_personalizado:true,descripcion:'Servicio',cantidad_base:2,cantidad_presentacion:2,
  precio_lista:20,precio_unitario:17.5,descuento_pct:0,nota:'Coordinar entrega',unidad_medida:'METRO',precio_modificado:true,modificado_por:'original@test'}]
let contactValid = true
let createdHeader: Omit<typeof sourceHeader, 'solicitado_por' | 'solicitante_id'> & { solicitado_por: string | null; solicitante_id: number | null }
beforeEach(() => {
  contactValid = true
  createdHeader = {...sourceHeader,id:99,numero:'COT-99',version:0,solicitado_por:'Bruno'}
  rpcMock.mockReset().mockImplementation(async (_name:string,p:Record<string,unknown>) => {
    createdHeader = {...createdHeader,notas:p.p_notas as string,solicitante_id:p.p_solicitante_id as number | null,
      solicitado_por:p.p_solicitante_id ? 'Bruno' : null}
    return {data:99,error:null}
  })
  fromMock.mockReset().mockImplementation((table:string) => {
    const filters:Record<string,unknown> = {}
    const query = {
      select:() => query,eq:(key:string,value:unknown) => {filters[key]=value;return query},order:() => query,
      maybeSingle:async () => ({data:table==='cliente_contacto' ? contactValid ? {id:12} : null : filters.id===99 ? createdHeader : sourceHeader,error:null}),
      then:(resolve:(result:unknown) => unknown) => Promise.resolve({data:sourceLines,error:null}).then(resolve),
    }
    return query
  })
})
describe('Cotizaciones — copias y persistencia de identidad', () => {
  it('la copia usa datos completos, notas y contacto validado; relee su propio ID, número, versión y nombre', async () => {
    const copy = await new SupabaseQuoteRepository().duplicate('42',{actorId:'nuevo@test'})
    expect(rpcMock).toHaveBeenCalledWith('crear_cotizacion',expect.objectContaining({
      p_notas:sourceHeader.notas,p_condiciones_comerciales:sourceHeader.condiciones_comerciales,p_cliente_id:1,p_solicitante_id:12,p_asunto:'Material',
      p_condicion_pago:'CREDITO',p_medio_pago:'TRANSFERENCIA',p_fecha:'2026-10-01',
      p_lineas:[expect.objectContaining({nota:'Coordinar entrega',unidad_medida:'METRO',precio_modificado:true,precio_unitario:17.5})],
    }))
    expect(copy).toMatchObject({id:'99',number:'COT-99',version:0,solicitanteNombre:'Bruno',notes:sourceHeader.notas,terms:sourceHeader.condiciones_comerciales})
    expect(sourceHeader).toMatchObject({id:42,version:3,solicitado_por:'Nombre histórico'})
  })
  it('un contacto inactivo o ajeno al cliente no se hereda en una copia nueva', async () => {
    contactValid = false
    const copy = await new SupabaseQuoteRepository().duplicate('42',{actorId:'nuevo@test'})
    expect(rpcMock).toHaveBeenCalledWith('crear_cotizacion',expect.objectContaining({p_cliente_id:1,p_solicitante_id:null}))
    expect(copy.solicitanteId).toBeUndefined()
    expect(copy.solicitanteNombre).toBeUndefined()
  })
  it('rechaza la versión que se abrió antes de una edición ajena sin reemplazar líneas ni cabecera', async () => {
    const repo = new SupabaseQuoteRepository()
    const loaded = (await repo.getById('42'))!
    await expect(repo.save({...loaded,version:2,customerId:'2'},{actorId:'nuevo@test'})).rejects.toBeInstanceOf(ConflictError)
    expect(rpcMock).not.toHaveBeenCalled()
  })
  it('manda el cliente y solicitante cambiados juntos a la RPC transaccional', async () => {
    const repo = new SupabaseQuoteRepository()
    const loaded = (await repo.getById('42'))!
    await repo.save({...loaded,customerId:'2',customerName:'Corporación B',solicitanteId:'23',solicitanteNombre:'Carla'},{actorId:'nuevo@test'})
    expect(rpcMock).toHaveBeenCalledWith('actualizar_cotizacion',expect.objectContaining({
      p_cliente_id:2,p_solicitante_id:23,p_version_actual:3,p_notas:sourceHeader.notas,p_condiciones_comerciales:sourceHeader.condiciones_comerciales,
    }))
  })
  it('crear una cotización desde el formulario también envía las observaciones', async () => {
    const draft:QuoteDraft = {id:'',number:'',customerId:'1',customerName:'Institución A',channel:'institucional',status:'draft',
      validUntil:'',terms:'',notes:'No entregar sin coordinación',generalDiscountCents:0,createdAt:'',lines:[]}
    await new SupabaseQuoteRepository().save(draft,{actorId:'nuevo@test'})
    expect(rpcMock).toHaveBeenCalledWith('crear_cotizacion',expect.objectContaining({p_notas:draft.notes}))
  })
})
