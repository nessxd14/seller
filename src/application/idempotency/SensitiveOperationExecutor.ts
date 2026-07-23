import type { IdempotencyService, SensitiveOperation } from './IdempotencyService'
import { DuplicateOperationError } from '../errors/AppError'

export class SensitiveOperationExecutor {
  private pending=new Set<string>()
  constructor(private readonly keys:IdempotencyService){}
  async execute<T>(operation:SensitiveOperation,aggregateId:string,handler:(idempotencyKey:string)=>Promise<T>):Promise<T>{
    const lock=`${operation}:${aggregateId}`
    if(this.pending.has(lock))throw new DuplicateOperationError('La operación ya está en curso')
    this.pending.add(lock)
    const key=this.keys.getOrCreate(operation,aggregateId)
    try{const result=await handler(key);this.keys.complete(operation,aggregateId);this.keys.clear(operation,aggregateId);return result}
    finally{this.pending.delete(lock)}
  }
}

