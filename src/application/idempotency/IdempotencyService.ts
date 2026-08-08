export type SensitiveOperation = 'confirm_sale'|'convert_quote'|'confirm_order'|'register_payment'|'open_cash'|'close_cash'|'dispatch'|'cancel'|'return'|'checkout'

export interface IdempotencyService {
  getOrCreate(operation: SensitiveOperation, aggregateId: string): string
  // Brief S5: `complete` existía pero SensitiveOperationExecutor.execute la llamaba
  // e inmediatamente después llamaba `clear`, que borra lo que `complete` acababa de
  // escribir — código muerto, nadie lo leía nunca. Se sacó de la interfaz en vez de
  // dársele un uso real: `clear` ya es la limpieza que importa (el aggregateId de una
  // operación exitosa no se vuelve a reutilizar — checkout, por ejemplo, avanza
  // operationId después de cada venta confirmada).
  clear(operation: SensitiveOperation, aggregateId: string): void
}

export class LocalIdempotencyService implements IdempotencyService {
  constructor(private readonly storage: Pick<Storage,'getItem'|'setItem'|'removeItem'> = localStorage) {}
  private key(operation: SensitiveOperation, aggregateId: string) { return `roari-idempotency:${operation}:${aggregateId}` }
  getOrCreate(operation: SensitiveOperation, aggregateId: string) {
    const key=this.key(operation,aggregateId)
    const existing=this.storage.getItem(key)
    if(existing)return existing
    const value=crypto.randomUUID()
    this.storage.setItem(key,value)
    return value
  }
  clear(operation: SensitiveOperation, aggregateId: string) { this.storage.removeItem(this.key(operation,aggregateId)) }
}

