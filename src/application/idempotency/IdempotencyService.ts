export type SensitiveOperation = 'confirm_sale'|'convert_quote'|'confirm_order'|'register_payment'|'open_cash'|'close_cash'|'dispatch'|'cancel'|'return'|'checkout'

export interface IdempotencyService {
  getOrCreate(operation: SensitiveOperation, aggregateId: string): string
  complete(operation: SensitiveOperation, aggregateId: string): void
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
  complete(operation: SensitiveOperation, aggregateId: string) { this.storage.setItem(`${this.key(operation,aggregateId)}:completed`,'true') }
  clear(operation: SensitiveOperation, aggregateId: string) { this.storage.removeItem(this.key(operation,aggregateId));this.storage.removeItem(`${this.key(operation,aggregateId)}:completed`) }
}

