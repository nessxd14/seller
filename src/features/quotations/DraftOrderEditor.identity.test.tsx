// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CustomerRecord, QuoteDraft } from '../../application/shared/models'
import { DraftOrderEditor } from './DraftOrderEditor'
import { borradorKey } from '../../hooks/useBorrador'

const { searchContacts } = vi.hoisted(() => ({ searchContacts: vi.fn() }))
const customers: CustomerRecord[] = [
  {id:'1',name:'Institución A',type:'institutional',document:'A',phone:'',email:'',address:'',usualChannel:'institucional',paymentTerms:''},
  {id:'2',name:'Corporación B',type:'corporate',document:'B',phone:'',email:'',address:'',usualChannel:'corporativo',paymentTerms:''},
]
vi.mock('../../config/featureFlags', () => ({featureFlags:{supabase:true}}))
vi.mock('../../infrastructure/services', () => ({
  customerService:{list:vi.fn(async () => customers)},
  productRepository:{search:vi.fn().mockResolvedValue({items:[],total:0}),getById:vi.fn().mockResolvedValue(null)},
  getStockByProduct:vi.fn().mockResolvedValue({}),getDisponibilidadPedido:vi.fn().mockResolvedValue({}),listPresentations:vi.fn().mockResolvedValue([]),
  listLineIdentifiers:vi.fn().mockResolvedValue({}),authSessionProvider:{getSession:vi.fn().mockResolvedValue(null)},
}))
vi.mock('../../components/SaldoBadge', () => ({SaldoBadge:() => null}))
vi.mock('../../infrastructure/supabase/ContactoCliente.supabase', () => ({
  buscarContactos:(...args:unknown[]) => searchContacts(...args),crearContacto:vi.fn(),
  evaluarTope:vi.fn().mockResolvedValue({dentroDelTope:true,motivoAdvertencia:null}),
}))
vi.mock('../../infrastructure/hermes/client', () => ({
  evaluarCredito:vi.fn().mockResolvedValue({estado:'ok',permitido:true}),
}))
const source: QuoteDraft = {
  id:'42',version:3,number:'COT-42',customerId:'1',customerName:'Institución A',
  channel:'institucional',status:'draft',conditionPago:'CONTADO',validUntil:'',terms:'',notes:'Entrega acordada',
  generalDiscountCents:0,createdAt:'2026-10-03',solicitanteId:'11',solicitanteNombre:'Ana',
  lines:[{id:'l1',productId:'',name:'Servicio',sku:'',quantity:1,unitPriceCents:1000,discountBasisPoints:0,isCustomItem:true}],
}
beforeEach(() => {
  localStorage.clear()
  searchContacts.mockReset().mockImplementation(async (id:string) => id==='1'
    ? [{id:'12',nombre:'Bruno',cargo:null,telefono:null,email:null,tope:null}]
    : [{id:'23',nombre:'Carla',cargo:null,telefono:null,email:null,tope:null}])
})
afterEach(() => { cleanup(); localStorage.clear() })
const mount = (quote:QuoteDraft = source, existing = true, onSave = vi.fn()) => {
  render(<DraftOrderEditor quote={quote} isExistingQuote={existing} onClose={() => {}} onSave={onSave} />)
  return onSave
}
const save = async () => act(async () => { fireEvent.click(screen.getByRole('button',{name:'Guardar como cotización'})) })

describe('Cotizaciones — búsquedas pendientes y envíos', () => {
  it('una respuesta tardía del cliente anterior no sustituye los contactos del nuevo', async () => {
    let resolveOld!: (contacts:unknown[]) => void
    searchContacts.mockImplementationOnce(() => new Promise(resolve => {resolveOld=resolve}))
    mount()
    fireEvent.click(await screen.findByRole('button',{name:/Ana/i}))
    await waitFor(() => expect(searchContacts).toHaveBeenCalledWith('1',null))
    fireEvent.focus(screen.getByRole('textbox',{name:/Cliente/}))
    fireEvent.change(screen.getByRole('textbox',{name:/Cliente/}),{target:{value:'Corporación'}})
    fireEvent.click(await screen.findByRole('button',{name:/Corporación B/}))
    fireEvent.click(await screen.findByRole('button',{name:/Sin elegir/i}))
    expect(await screen.findByRole('button',{name:'Carla'})).toBeTruthy()
    await act(async () => {resolveOld([{id:'12',nombre:'Bruno'}])})
    expect(screen.queryByRole('button',{name:'Bruno'})).toBeNull()
    expect(screen.getByRole('button',{name:'Carla'})).toBeTruthy()
  })
  it('cancelar la conversión conserva el borrador recuperable', async () => {
    const key = borradorKey('cotizacion:42','pos')
    localStorage.setItem(key,JSON.stringify({datos:source,guardadoEn:Date.now()}))
    // El ítem a pedido de la cotización siempre va a Compras: el editor pide confirmar antes de convertir.
    vi.spyOn(window,'confirm').mockReturnValue(true)
    const onConvert = vi.fn(() => false as const)
    render(<DraftOrderEditor quote={source} isExistingQuote onClose={() => {}} onSave={vi.fn()} onConvert={onConvert} />)
    await screen.findByRole('button',{name:'Retomar'})
    await act(async () => {fireEvent.click(screen.getByRole('button',{name:'Convertir a pedido'}))})
    expect(onConvert).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(key)).not.toBeNull()
  })
  it('no permite cerrar ni modificar el formulario mientras se guarda', async () => {
    let finish!: () => void
    const onSave = vi.fn(() => new Promise<void>(resolve => {finish=resolve}))
    const onClose = vi.fn()
    render(<DraftOrderEditor quote={source} isExistingQuote onClose={onClose} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button',{name:'Guardar como cotización'}))
    fireEvent.click(screen.getByRole('button',{name:'Cerrar'}))
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('.draft-order-editor')?.hasAttribute('inert')).toBe(true)
    await act(async () => {finish()})
    expect(document.querySelector('.draft-order-editor')?.hasAttribute('inert')).toBe(false)
  })
})

describe('Cotizaciones — identidad de cliente/solicitante y recuperación', () => {
  it('guarda el nuevo solicitante con ID y nombre sin modificar el objeto original', async () => {
    const onSave = mount()
    fireEvent.click(await screen.findByRole('button',{name:/Ana/i}))
    fireEvent.click(await screen.findByRole('button',{name:'Bruno'}))
    await save()
    expect(onSave.mock.calls[0][0]).toMatchObject({id:'42',version:3,customerId:'1',solicitanteId:'12',solicitanteNombre:'Bruno'})
    expect(source.solicitanteNombre).toBe('Ana')
  })
  it('cambiar de cliente limpia el solicitante anterior y busca solo los contactos del nuevo cliente', async () => {
    const onSave = mount()
    const input = screen.getByRole('textbox',{name:/Cliente/})
    fireEvent.focus(input)
    fireEvent.change(input,{target:{value:'Corporación'}})
    fireEvent.click(await screen.findByRole('button',{name:/Corporación B/}))
    fireEvent.click(await screen.findByRole('button',{name:/Sin elegir/i}))
    fireEvent.click(await screen.findByRole('button',{name:'Carla'}))
    await save()
    expect(searchContacts).toHaveBeenCalledWith('2',null)
    expect(onSave.mock.calls[0][0]).toMatchObject({customerId:'2',customerName:'Corporación B',channel:'corporativo',solicitanteId:'23',solicitanteNombre:'Carla'})
  })
  it('volver a elegir el mismo cliente conserva su solicitante; quitarlo limpia ambos campos', async () => {
    const onSave = mount()
    fireEvent.focus(screen.getByRole('textbox',{name:/Cliente/}))
    fireEvent.click(await screen.findByRole('button',{name:/Institución A/}))
    fireEvent.click(await screen.findByRole('button',{name:/Ana/i}))
    fireEvent.click(screen.getByRole('button',{name:'Sin solicitante'}))
    await save()
    expect(onSave.mock.calls[0][0].solicitanteId).toBeUndefined()
    expect(onSave.mock.calls[0][0].solicitanteNombre).toBeUndefined()
  })
  it('abrir la copia no ofrece el borrador de otra cotización ni el antiguo borrador global', async () => {
    for (const key of [borradorKey('cotizacion:41','pos'),borradorKey('cotizacion','pos')]) {
      localStorage.setItem(key,JSON.stringify({datos:{...source,id:'41',customerId:'2'},guardadoEn:Date.now()}))
    }
    const onSave = mount()
    await screen.findByRole('button',{name:/Ana/i})
    expect(screen.queryByRole('button',{name:'Retomar'})).toBeNull()
    await save()
    expect(onSave.mock.calls[0][0]).toMatchObject({id:'42',customerId:'1'})
  })
  it('restaurar su propio borrador conserva la versión original para detectar cambios de otra sesión', async () => {
    localStorage.setItem(borradorKey('cotizacion:42','pos'),JSON.stringify({
      datos:{...source,version:2,solicitanteId:'12',solicitanteNombre:'Bruno'},guardadoEn:Date.now(),
    }))
    const onSave = mount()
    fireEvent.click(await screen.findByRole('button',{name:'Retomar'}))
    await save()
    expect(onSave.mock.calls[0][0]).toMatchObject({id:'42',version:2,solicitanteId:'12'})
  })
  it('restaurar una nueva cotización nunca toma el ID de otra guardada', async () => {
    localStorage.setItem(borradorKey('cotizacion:nueva','pos'),JSON.stringify({datos:source,guardadoEn:Date.now()}))
    const onSave = mount({...source,id:'',version:undefined,number:''},false)
    fireEvent.click(await screen.findByRole('button',{name:'Retomar'}))
    await save()
    expect(onSave.mock.calls[0][0].id).toBe('')
    expect(onSave.mock.calls[0][0].number).toBe('')
    expect(onSave.mock.calls[0][0].version).toBeUndefined()
  })
  it('un fallo de búsqueda termina la carga y muestra cómo reintentar', async () => {
    searchContacts.mockRejectedValue({message:'sin conexión'})
    mount()
    fireEvent.click(await screen.findByRole('button',{name:/Ana/i}))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('No se pudieron cargar'))
    await waitFor(() => expect(screen.queryByText('Buscando…')).toBeNull())
  })
})
