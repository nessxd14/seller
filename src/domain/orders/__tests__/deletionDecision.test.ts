import { describe, expect, it } from 'vitest'
import { decidirEliminacionPedido, type PuedeEliminarsePedidoInfo } from '../deletionDecision'

const check = (overrides: Partial<PuedeEliminarsePedidoInfo> = {}): PuedeEliminarsePedidoInfo => ({
  existe: true,
  despachadas: 0,
  movioKardex: false,
  puedeBorrarse: true,
  ...overrides,
})

describe('decidirEliminacionPedido — mapeo de puede_eliminarse_pedido a la decisión de UI', () => {
  it('pedido sin despachos: se ofrece eliminar', () => {
    expect(decidirEliminacionPedido(check({ puedeBorrarse: true }))).toEqual({ kind: 'ready' })
  })

  it('pedido con líneas despachadas: no se ofrece, explica por qué', () => {
    const decision = decidirEliminacionPedido(check({ puedeBorrarse: false, despachadas: 3, movioKardex: true }))
    expect(decision.kind).toBe('blocked')
    expect(decision.kind === 'blocked' && decision.reason).toContain('despachó mercadería')
    expect(decision.kind === 'blocked' && decision.reason).toContain('3 líneas')
    expect(decision.kind === 'blocked' && decision.reason).toContain('Anulalo')
  })

  it('pedido que ya no existe: bloquea sin ofrecer nada', () => {
    const decision = decidirEliminacionPedido(check({ existe: false, puedeBorrarse: true }))
    expect(decision).toEqual({ kind: 'blocked', reason: 'El pedido ya no existe.' })
  })
})
