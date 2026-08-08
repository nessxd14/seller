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
    try{const result=await handler(key);this.keys.clear(operation,aggregateId);return result}
    finally{this.pending.delete(lock)}
  }
  /**
   * Brief S5: helper reutilizable para flujos que, como saleService.checkout, arman el
   * aggregateId combinando un id de operación estable (persiste ante un F5 fallido) con
   * una huella del contenido exacto que se está enviando (para que cualquier cambio real
   * cuente como una operación nueva, no un reintento de otra). Evita que cada flujo nuevo
   * (ej. PagoModal) tenga que replicar `${operationId}:${huella}` a mano.
   */
  ejecutarIdempotente<T>(operation:SensitiveOperation,operationId:string,huella:string,handler:(idempotencyKey:string)=>Promise<T>):Promise<T>{
    return this.execute(operation,`${operationId}:${huella}`,handler)
  }
}

