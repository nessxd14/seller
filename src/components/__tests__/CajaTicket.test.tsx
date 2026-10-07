// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { CajaReceipt } from '../../application/shared/cajaCheckout'
import { CajaTicket } from '../CajaTicket'
const mocks=vi.hoisted(()=>({ticket:vi.fn(),bank:vi.fn()}))
vi.mock('../../infrastructure/services',()=>({saleService:{getTicket:mocks.ticket},turnoService:{estadoBancoQr:mocks.bank}}))
vi.mock('../../config/empresaStore',()=>({empresaStore:{razonSocial:'Prueba'},loadEmpresaConfig:async()=>{}}))
const receipt=():CajaReceipt=>({id:'1',numero:'CJA-TEST',totalCents:10000,saleIds:['1','2'],isRetry:false,vendedor:'Ana',cliente:null,lineas:[],pagos:[{metodo:'QR',monto:100}],creadoEn:new Date().toISOString(),balanceCents:0,discountCents:0,changeCents:0})
beforeEach(()=>{vi.clearAllMocks();mocks.bank.mockResolvedValue({enLinea:true});mocks.ticket.mockImplementation(async(id:string)=>({estado:'COMPLETADA',pagos:[{estadoVerificacion:id==='1'?'VERIFICADO':'PENDIENTE'}]}))})
afterEach(cleanup)
it('una operación con QR pendiente impide imprimir el comprobante reciente',async()=>{
  render(<CajaTicket receipt={receipt()} onClose={()=>{}} />)
  await screen.findByText('Esperando confirmación del QR antes de imprimir.')
  expect((screen.getByRole('button',{name:'Imprimir'}) as HTMLButtonElement).disabled).toBe(true)
})
it('con banco fuera de línea permite imprimir con la marca de pago pendiente',async()=>{
  mocks.bank.mockResolvedValue({enLinea:false});render(<CajaTicket receipt={receipt()} onClose={()=>{}} />)
  await waitFor(()=>expect((screen.getByRole('button',{name:'Imprimir'}) as HTMLButtonElement).disabled).toBe(false))
  expect(screen.getByText('PAGO DIGITAL PENDIENTE DE VERIFICACIÓN')).toBeTruthy()
})
it('una operación anulada impide reimprimir el documento como válido',async()=>{
  mocks.ticket.mockResolvedValue({estado:'ANULADA',pagos:[]});render(<CajaTicket receipt={receipt()} onClose={()=>{}} />)
  await screen.findByText('CONTIENE UNA OPERACIÓN ANULADA')
  expect((screen.getByRole('button',{name:'Imprimir'}) as HTMLButtonElement).disabled).toBe(true)
})
