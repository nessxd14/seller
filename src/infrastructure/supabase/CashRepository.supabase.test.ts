import {beforeEach, describe, expect, it, vi} from 'vitest'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('./supabaseClient',()=>({supabase:{rpc}}))
import {SupabaseCashRepository} from './CashRepository.supabase'
const repo=new SupabaseCashRepository()
const input={customerId:'83',amountCents:12550,method:'qr' as const,sessionId:'4'}
const context={actorId:'actor',idempotencyKey:'stable-payment-1'}
describe('Cobro conjunto de caja y Hermes',()=>{
 beforeEach(()=>rpc.mockReset())
 it('envía monto, reparto y anticipo en una sola transacción con clave estable',async()=>{
  rpc.mockResolvedValue({data:{movementId:241,pagoId:30,saldoProvisional:25},error:null})
  await expect(repo.registerPayment({...input,aplicaciones:[{partidaId:13,monto:100}],noImputar:false},context))
   .resolves.toEqual({movementId:'241',pagoId:'30',saldoProvisional:25})
  expect(rpc).toHaveBeenCalledOnce()
  expect(rpc).toHaveBeenCalledWith('registrar_cobro_hermes',expect.objectContaining({
   p_cliente_id:83,p_monto:125.5,p_metodo:'QR',p_idempotencia:context.idempotencyKey,
   p_aplicaciones:[{partida_id:13,monto:100}],p_no_imputar:false,
  }))
 })
 it('propaga el error sin intentar guardar solo en caja',async()=>{
  rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'RPC no disponible'}})
  await expect(repo.registerPayment(input,context)).rejects.toMatchObject({code:'PGRST202'})
  expect(rpc).toHaveBeenCalledOnce()
 })
 it('rechaza un resultado que no verifica ambas partes del cobro',async()=>{
  rpc.mockResolvedValue({data:{movementId:241},error:null})
  await expect(repo.registerPayment(input,context)).rejects.toThrow('registro conjunto')
 })
 it('un anticipo de pedido usa el mismo registro conjunto y la misma clave de reintento',async()=>{
  rpc.mockResolvedValue({data:{movementId:241,pagoId:30,saldoProvisional:0},error:null})
  await repo.registerAdvance({orderId:'344',sessionId:'4',amountCents:35000,method:'cash'},context)
  expect(rpc).toHaveBeenCalledWith('registrar_cobro_hermes',expect.objectContaining({
   p_pedido_id:344,p_cliente_id:null,p_monto:350,p_metodo:'EFECTIVO',p_idempotencia:context.idempotencyKey,
  }))
 })
})
