import { describe, expect, it } from 'vitest'
import { ConflictError } from '../errors/AppError'
import type { MutationContext, PageRequest, Versioned } from '../ports/repositories'

export interface ContractRepository<T extends {id:string}> {
  list(request:PageRequest):Promise<{items:Array<T&Versioned>;total:number}>
  getById(id:string):Promise<(T&Versioned)|null>
  save(value:T&Partial<Versioned>,context?:MutationContext):Promise<T&Versioned>
  remove?(id:string,context?:MutationContext):Promise<void>
  simulateConcurrentUpdate?(id:string):void
}
export interface ContractFixture<T extends {id:string}>{repository:ContractRepository<T>;create:()=>T}

const runCrudContract=<T extends{id:string}>(label:string,factory:()=>ContractFixture<T>)=>describe(`${label} repository contract`,()=>{
  it('crea, obtiene y pagina registros versionados',async()=>{const{repository,create}=factory();const saved=await repository.save(create());expect(saved.version).toBe(1);expect((await repository.getById(saved.id))?.id).toBe(saved.id);expect((await repository.list({page:1,pageSize:10})).total).toBeGreaterThan(0)})
  it('actualiza solo con la versión esperada',async()=>{const{repository,create}=factory();const saved=await repository.save(create());const updated=await repository.save({...saved},{expectedVersion:saved.version});expect(updated.version).toBe(2)})
  it('rechaza escrituras con versión desactualizada',async()=>{const{repository,create}=factory();const saved=await repository.save(create());repository.simulateConcurrentUpdate?.(saved.id);await expect(repository.save({...saved},{expectedVersion:saved.version})).rejects.toBeInstanceOf(ConflictError)})
  it('reutiliza resultado para la misma clave idempotente',async()=>{const{repository,create}=factory();const value=create();const first=await repository.save(value,{idempotencyKey:'same-key'});const second=await repository.save(value,{idempotencyKey:'same-key'});expect(second).toEqual(first)})
})
export const runQuoteRepositoryContractTests=<T extends{id:string}>(factory:()=>ContractFixture<T>)=>runCrudContract('Quote',factory)
export const runOrderRepositoryContractTests=<T extends{id:string}>(factory:()=>ContractFixture<T>)=>runCrudContract('Order',factory)
export const runSaleRepositoryContractTests=<T extends{id:string}>(factory:()=>ContractFixture<T>)=>runCrudContract('Sale',factory)
export const runCashRepositoryContractTests=<T extends{id:string}>(factory:()=>ContractFixture<T>)=>runCrudContract('Cash',factory)
export const runCustomerRepositoryContractTests=<T extends{id:string}>(factory:()=>ContractFixture<T>)=>runCrudContract('Customer',factory)

