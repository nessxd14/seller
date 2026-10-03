// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { ventaDirectaMockRepository as repo } from './VentaDirectaRepository.mock'

const abrir = (customerId?: string) => repo.abrir({ lines: [{ productId: '1', cantidadPresentacion: 1, unitPriceCents: 10000 }], ubicacionId: 1, cashSessionId: '1', customerId }, 'tester')
beforeEach(() => localStorage.clear())

describe('mock de Venta Directa — mismas reglas que la base', () => {
  it('completar rechaza una VTD sin cobrar ni marcar, con el mensaje del trigger', async () => {
    const v = await abrir()
    await expect(repo.completar(v.id)).rejects.toThrow(`${v.numero} no está cobrada. Cóbrala en caja antes de entregar, o márcala como pago posterior con motivo.`)
  })

  it('marcarPagoPosterior valida motivo ≥ 5 y contacto cuando no hay cliente, y habilita completar', async () => {
    const v = await abrir()
    await expect(repo.marcarPagoPosterior(v.id, 'abc', 'Ana 700')).rejects.toThrow(/al menos 5/)
    await expect(repo.marcarPagoPosterior(v.id, 'Paga el viernes', 'ab')).rejects.toThrow(/Indica quién se lleva/)
    await repo.marcarPagoPosterior(v.id, 'Paga el viernes', 'Ana 700')
    const marcada = await repo.getById(v.id)
    expect(marcada).toMatchObject({ pagoPosterior: true, pagoPosteriorMotivo: 'Paga el viernes', pagoPosteriorContacto: 'Ana 700' })
    await expect(repo.completar(v.id)).resolves.toMatchObject({ estado: 'COMPLETADA' })
  })

  it('con cliente no pide contacto; una venta ya cobrada o ya entregada no se puede marcar', async () => {
    const conCliente = await abrir('5')
    await repo.marcarPagoPosterior(conCliente.id, 'Cliente de confianza')
    const cobrada = await abrir()
    await repo.cobrarVtd({ ventaIds: [cobrada.id], sesionCajaId: '1', pagos: [{ method: 'cash', amountCents: 10000 }] })
    await expect(repo.marcarPagoPosterior(cobrada.id, 'Paga el viernes', 'Ana 700')).rejects.toThrow(/ya tiene un pago/)
    await repo.completar(cobrada.id)
    await expect(repo.marcarPagoPosterior(cobrada.id, 'Paga el viernes', 'Ana 700')).rejects.toThrow(/no está abierta/)
  })

  it('una VTD pagada completa; listPorCobrar expone la marca de pago posterior', async () => {
    const v = await abrir()
    await repo.marcarPagoPosterior(v.id, 'Paga el viernes', 'Ana 700')
    const [fila] = await repo.listPorCobrar()
    expect(fila).toMatchObject({ pagoPosterior: true, pagoPosteriorContacto: 'Ana 700' })
  })
})
