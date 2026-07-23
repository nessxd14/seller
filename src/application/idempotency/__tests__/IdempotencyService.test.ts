import { describe,expect,it } from 'vitest'
import { LocalIdempotencyService } from '../IdempotencyService'
import { SensitiveOperationExecutor } from '../SensitiveOperationExecutor'

class StorageMock{values=new Map<string,string>();getItem(key:string){return this.values.get(key)??null}setItem(key:string,value:string){this.values.set(key,value)}removeItem(key:string){this.values.delete(key)}}
describe('IdempotencyService',()=>{
  it('reutiliza la clave durante reintentos',()=>{const storage=new StorageMock();const service=new LocalIdempotencyService(storage);const first=service.getOrCreate('dispatch','o1');expect(service.getOrCreate('dispatch','o1')).toBe(first)})
  it('genera otra clave después de limpiar',()=>{const storage=new StorageMock();const service=new LocalIdempotencyService(storage);const first=service.getOrCreate('register_payment','s1');service.clear('register_payment','s1');expect(service.getOrCreate('register_payment','s1')).not.toBe(first)})
  it('reutiliza la clave después de un timeout',async()=>{const storage=new StorageMock();const service=new LocalIdempotencyService(storage);const executor=new SensitiveOperationExecutor(service);let first='';await expect(executor.execute('confirm_sale','s1',async(key)=>{first=key;throw new Error('timeout')})).rejects.toThrow();await executor.execute('confirm_sale','s1',async(key)=>{expect(key).toBe(first);return true})})
})
