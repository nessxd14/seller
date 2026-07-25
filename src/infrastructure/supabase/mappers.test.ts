import { describe, expect, it } from 'vitest'
import {
  bpToPct, categoriaToChannel, centsToNumeric, channelToCategoria, channelToPriceField,
  customerTypeToTipoPrecio, defaultSucursalForChannel, locationToSucursalId, numericToCents,
  pctToBp, sucursalIdToLocation, tipoPrecioToCustomerType, SUCURSAL_ALMACEN_ID, SUCURSAL_TIENDA_ID,
} from './mappers'
import type { SalesChannel } from '../../domain/common/types'
import type { CustomerRecord } from '../../application/shared/models'

describe('mappers', () => {
  it('round-trips channel <-> categoria', () => {
    const channels: SalesChannel[] = ['retail', 'mayoreo', 'institucional', 'municipal']
    for (const channel of channels) expect(categoriaToChannel(channelToCategoria(channel))).toBe(channel)
    expect(channelToCategoria('retail')).toBe('TIENDA')
    expect(channelToCategoria('mayoreo')).toBe('MAYOR')
    expect(channelToCategoria('institucional')).toBe('INSTITUCIONAL')
    expect(channelToCategoria('municipal')).toBe('MUNICIPAL')
  })

  it('round-trips customer type <-> tipo_precio', () => {
    const types: CustomerRecord['type'][] = ['retail', 'wholesale', 'institutional', 'municipal']
    for (const type of types) expect(tipoPrecioToCustomerType(customerTypeToTipoPrecio(type))).toBe(type)
    expect(customerTypeToTipoPrecio('wholesale')).toBe('mayorista')
    expect(customerTypeToTipoPrecio('institutional')).toBe('institucion')
  })

  it('round-trips cents <-> numeric with correct rounding', () => {
    expect(centsToNumeric(1050)).toBe(10.5)
    expect(numericToCents(10.5)).toBe(1050)
    expect(numericToCents(centsToNumeric(1050))).toBe(1050)
    expect(centsToNumeric(numericToCents(10.5))).toBe(10.5)
    expect(numericToCents(9.999)).toBe(1000)
  })

  it('round-trips basis points <-> pct', () => {
    expect(bpToPct(1000)).toBe(10)
    expect(pctToBp(10)).toBe(1000)
    expect(pctToBp(bpToPct(1000))).toBe(1000)
    expect(bpToPct(pctToBp(10))).toBe(10)
    expect(bpToPct(250)).toBe(2.5)
    expect(pctToBp(2.5)).toBe(250)
  })

  it('maps location <-> sucursal id', () => {
    expect(locationToSucursalId('Tienda')).toBe(SUCURSAL_TIENDA_ID)
    expect(locationToSucursalId('Almacén')).toBe(SUCURSAL_ALMACEN_ID)
    expect(sucursalIdToLocation(SUCURSAL_TIENDA_ID)).toBe('Tienda')
    expect(sucursalIdToLocation(SUCURSAL_ALMACEN_ID)).toBe('Almacén')
    expect(sucursalIdToLocation(null)).toBe('Almacén')
  })

  it('defaults sucursal per channel', () => {
    expect(defaultSucursalForChannel('retail')).toBe(SUCURSAL_TIENDA_ID)
    expect(defaultSucursalForChannel('mayoreo')).toBe(SUCURSAL_ALMACEN_ID)
    expect(defaultSucursalForChannel('institucional')).toBe(SUCURSAL_ALMACEN_ID)
    expect(defaultSucursalForChannel('municipal')).toBe(SUCURSAL_ALMACEN_ID)
  })

  it('maps channel to price column', () => {
    expect(channelToPriceField('retail')).toBe('precio_base')
    expect(channelToPriceField('mayoreo')).toBe('precio_mayoreo')
    expect(channelToPriceField('institucional')).toBe('precio_institucion')
    expect(channelToPriceField('municipal')).toBe('precio_municipal')
  })
})
