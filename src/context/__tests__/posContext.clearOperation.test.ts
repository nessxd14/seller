// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { PosProvider, usePos } from '../PosContext'

describe('PosContext.clearOperation — suspender/solicitar traslado no deben dejar pegado al cliente ni al canal', () => {
  it('resetea customer/channel/mode pero no avanza operationNumber', () => {
    const { result } = renderHook(() => usePos(), { wrapper: PosProvider })
    const operationNumberAntes = result.current.operationNumber
    const operationIdAntes = result.current.operationId

    act(() => {
      // id no numérico: evita el fetch a consultarSaldos (rama esAcreedor) — acá
      // solo importa el reseteo de campos, no la consulta a Hermes.
      result.current.selectCustomer({ id: 'no-numeric', name: 'Droguería Inti', documento: 'NIT-123' })
      result.current.setChannel('corporativo')
      result.current.setMode('traslado')
    })

    expect(result.current.customer?.name).toBe('Droguería Inti')
    expect(result.current.channel).toBe('corporativo')
    expect(result.current.mode).toBe('traslado')

    act(() => {
      result.current.clearOperation()
    })

    expect(result.current.customer).toBeNull()
    expect(result.current.channel).toBe('retail')
    expect(result.current.mode).toBe('venta')
    expect(result.current.operationNumber).toBe(operationNumberAntes)
    expect(result.current.operationId).toBe(operationIdAntes)
  })
})
