import { describe, expect, it } from 'vitest'
import { ConflictError } from '../../../application/errors/AppError'
import { VersionedLocalRepository } from '../VersionedLocalRepository'

type ScenarioRecord = {
  id:string
  status:string
  note?:string
}

const current = (id:string,status:string):ScenarioRecord & {version:number;updatedAt:string} => ({
  id,
  status,
  version:1,
  updatedAt:'2026-07-23T12:00:00.000Z',
})

describe('conflictos concurrentes relevantes para integración',()=>{
  it.each([
    {label:'cotización convertida mientras se editaba',id:'quote-1',initial:'draft',external:'converted'},
    {label:'pedido actualizado durante preparación',id:'order-1',initial:'preparing',external:'partially_dispatched'},
    {label:'caja cerrada desde otra sesión',id:'cash-1',initial:'open',external:'closed'},
  ])('rechaza $label',async({id,initial,external})=>{
    const repository=new VersionedLocalRepository<ScenarioRecord>([current(id,initial)])
    const stale=await repository.getById(id)
    repository.simulateConcurrentMutation(id,(record)=>({...record,status:external}))
    await expect(repository.save({...stale!,note:'cambio local'},{expectedVersion:stale!.version})).rejects.toBeInstanceOf(ConflictError)
    expect((await repository.getById(id))?.status).toBe(external)
  })
})
