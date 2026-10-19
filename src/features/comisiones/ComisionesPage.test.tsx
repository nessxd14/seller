// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ComisionesPage } from './ComisionesPage'
import { HistorialComision } from './HistorialComision'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),rows:vi.fn(),vendedores:vi.fn(),seguimiento:vi.fn(),lineas:vi.fn(),historial:vi.fn(),anular:vi.fn()}))
vi.mock('../../infrastructure/supabase/supabaseClient',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../infrastructure/services',()=>({comisionesService:{getMisComisiones:mocks.rows,getEquipo:mocks.rows,listVendedores:mocks.vendedores,getSeguimiento:mocks.seguimiento,getLineasDevengo:mocks.lineas,listLiquidaciones:mocks.historial,anularLiquidacion:mocks.anular}}))
const row={id:'1',origen:'PEDIDO',documentoId:'701',vendedorEmail:'vendedor@test.invalid',clienteNombre:'Cliente de prueba',fecha:'2026-10-17',baseComisionableCents:10000,totalDocumentoCents:10000,porcentajeBp:100,montoCents:100,estado:'POTENCIAL',liquidacionId:null,liquidacionFecha:null,tienePersonalizadoComisionable:false,cobroEstado:'por_verificar',partidasVigentes:2,partidasSaldadas:1,revisionMotivo:null}
beforeEach(()=>{vi.clearAllMocks();mocks.rows.mockResolvedValue([row]);mocks.vendedores.mockResolvedValue([]);mocks.seguimiento.mockResolvedValue([]);mocks.lineas.mockResolvedValue([]);mocks.historial.mockResolvedValue([]);mocks.rpc.mockResolvedValue({data:[],error:null});mocks.anular.mockResolvedValue(undefined)})
afterEach(cleanup)
describe('Comisiones y cobro compartido',()=>{
 it('separa pago por verificar y muestra las partidas saldadas',async()=>{
  render(<ComisionesPage notify={vi.fn()} vendedorEmail={row.vendedorEmail} esGerente />)
  expect(await screen.findByText('Pago registrado · falta verificación')).toBeTruthy()
  expect(screen.getByText('1 de 2 partidas saldadas')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'Ver productos de 701'}))
  expect((await screen.findByRole('link',{name:'Ver partidas, cobros y responsables del pedido'})).getAttribute('href')).toBe('/pedidos/701')
 })
 it('hace visible la deuda reabierta de una comisión ya liquidada',async()=>{
  mocks.rows.mockResolvedValue([{...row,estado:'LIQUIDADA',revisionMotivo:'Comisión ya liquidada: requiere revisión de gerencia.'}])
  render(<ComisionesPage notify={vi.fn()} vendedorEmail={row.vendedorEmail} esGerente />)
  expect(await screen.findByText('Comisión ya liquidada: requiere revisión de gerencia.')).toBeTruthy()
 })
 it('conserva el autor, rol y motivo en el historial',async()=>{
  mocks.rpc.mockResolvedValue({data:[{id:10,actor:{id:'1',nombre:'Ana prueba',rol:'gerente',rol_actual:null,historico:false},antes:{estado:'LIQUIDADA'},despues:{estado:'POTENCIAL',motivo_anulacion_liquidacion:'Pago retirado'},creado_en:'2026-10-17T23:10:00Z'}],error:null})
  render(<HistorialComision id="1" />)
  expect(await screen.findByText('Ana prueba · Gerente')).toBeTruthy()
  expect(screen.getByText('Motivo de anulación: Pago retirado')).toBeTruthy()
 })
 it('solicita un motivo antes de anular una liquidación',async()=>{
  mocks.historial.mockResolvedValue([{id:'7',vendedorEmail:row.vendedorEmail,montoTotalCents:100,medioPago:'EFECTIVO',creadoEn:'2026-10-17T20:00:00Z',anuladoEn:null}])
  render(<ComisionesPage notify={vi.fn()} vendedorEmail={row.vendedorEmail} esGerente />)
  fireEvent.click(screen.getByRole('button',{name:'Liquidar'}))
  fireEvent.click(await screen.findByRole('button',{name:'Anular'}))
  const confirmar=screen.getByRole('button',{name:'Confirmar anulación'}) as HTMLButtonElement
  expect(confirmar.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Motivo de anulación'),{target:{value:'Pago revertido'}})
  fireEvent.click(confirmar)
  await screen.findByRole('button',{name:'Anular'})
  expect(mocks.anular).toHaveBeenCalledWith('7','Pago revertido')
 })
 it('permite revisar una base modificada con el total actual y motivo',async()=>{
  mocks.rows.mockResolvedValue([{...row,revisionMotivo:'El importe del pedido cambió.'}])
  mocks.rpc.mockImplementation((name:string)=>Promise.resolve(name==='consultar_detalle_cobro_pedido'?{data:{pedido:{id:701,numero:'701',estado:'ABIERTO',total:100},resumen:{vigentes:0,saldadas:0,anuladas:0},partidas:[],pagos:[],saldos:[],historial:[],historial_total:0,siguiente:null,captura_desde:null},error:null}:{data:[],error:null}))
  render(<ComisionesPage notify={vi.fn()} vendedorEmail={row.vendedorEmail} esGerente />)
  fireEvent.click(await screen.findByRole('button',{name:'Ver productos de 701'}))
  fireEvent.click(await screen.findByRole('button',{name:'Revisar base de comisión'}))
  fireEvent.change(await screen.findByLabelText('Motivo de la revisión'),{target:{value:'Revisadas las líneas vigentes'}})
  const boton=screen.getByRole('button',{name:'Guardar revisión'}) as HTMLButtonElement
  await vi.waitFor(()=>expect(boton.disabled).toBe(false))
  fireEvent.click(boton)
  await vi.waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith('comision_revisar_base',expect.objectContaining({p_devengo_id:1,p_total_revisado:100,p_motivo:'Revisadas las líneas vigentes'})))
 })
 it('muestra correctamente la fecha de una liquidación con timestamp',async()=>{
  mocks.rows.mockResolvedValue([{...row,estado:'LIQUIDADA',liquidacionFecha:'2026-10-18T01:00:00Z'}])
  render(<ComisionesPage notify={vi.fn()} vendedorEmail={row.vendedorEmail} esGerente />)
  expect(await screen.findByText(/Liquidada el/)).toBeTruthy()
  expect(screen.queryByText(/Invalid Date/)).toBeNull()
 })
})
