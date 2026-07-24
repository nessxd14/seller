import { ConflictError, DuplicateOperationError, NotFoundError } from '../../application/errors/AppError'
import type { MutationContext, Page, PageRequest, Versioned } from '../../application/ports/repositories'

export class VersionedLocalRepository<T extends {id:string}> {
  private processed=new Map<string,T&Versioned>()
  constructor(private values:Array<T&Versioned> = []){}
  page(items:Array<T&Versioned>,request:PageRequest):Page<T&Versioned>{const start=(request.page-1)*request.pageSize;return{items:structuredClone(items.slice(start,start+request.pageSize)),page:request.page,pageSize:request.pageSize,total:items.length}}
  async list(request:PageRequest){return this.page(this.values,request)}
  async getById(id:string){return structuredClone(this.values.find((item)=>item.id===id)??null)}
  async save(value:T&Partial<Versioned>,context:MutationContext={}):Promise<T&Versioned>{
    if(context.idempotencyKey&&this.processed.has(context.idempotencyKey))return structuredClone(this.processed.get(context.idempotencyKey)!)
    const index=this.values.findIndex((item)=>item.id===value.id)
    const current=index>=0?this.values[index]:undefined
    if(current&&context.expectedVersion!==undefined&&current.version!==context.expectedVersion)throw new ConflictError('El registro fue modificado por otra sesión',{expected:context.expectedVersion,actual:current.version,record:structuredClone(current)})
    const saved={...structuredClone(value),version:(current?.version??0)+1,updatedAt:new Date().toISOString()} as T&Versioned
    if(index>=0)this.values[index]=saved;else this.values.unshift(saved)
    if(context.idempotencyKey)this.processed.set(context.idempotencyKey,saved)
    return structuredClone(saved)
  }
  async remove(id:string,context:MutationContext={}){
    const index=this.values.findIndex((item)=>item.id===id)
    if(index<0)throw new NotFoundError('Registro no encontrado')
    if(context.expectedVersion!==undefined&&this.values[index].version!==context.expectedVersion)throw new ConflictError('Versión desactualizada')
    this.values.splice(index,1)
  }
  simulateConcurrentUpdate(id:string){
    const item=this.values.find((candidate)=>candidate.id===id)
    if(!item)throw new NotFoundError('Registro no encontrado')
    item.version+=1;item.updatedAt=new Date().toISOString()
  }
  simulateConcurrentMutation(id:string,mutate:(value:T&Versioned)=>T&Versioned){
    const index=this.values.findIndex((candidate)=>candidate.id===id)
    if(index<0)throw new NotFoundError('Registro no encontrado')
    this.values[index]={...mutate(structuredClone(this.values[index])),version:this.values[index].version+1,updatedAt:new Date().toISOString()}
  }
  assertNewIdempotencyKey(key:string){if(this.processed.has(key))throw new DuplicateOperationError('Operación duplicada')}
}
