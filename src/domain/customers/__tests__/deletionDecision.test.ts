import { describe, expect, it } from 'vitest'
import { decidirEliminacionCliente, type PuedeEliminarseClienteInfo } from '../deletionDecision'

const local = (overrides: Partial<PuedeEliminarseClienteInfo> = {}): PuedeEliminarseClienteInfo => ({
  existe: true,
  nombre: 'Cliente Prueba',
  ventas: 0,
  pedidos: 0,
  cotizaciones: 0,
  movimientosCaja: 0,
  puedeBorrarse: true,
  ...overrides,
})

describe('decidirEliminacionCliente — orden estricto: local (Cation) primero, después Hermes', () => {
  it('sin historial y sin presencia en Hermes: se ofrece eliminar', () => {
    expect(decidirEliminacionCliente(local(), 'no-existe')).toEqual({ kind: 'ready' })
  })

  it('con historial en Cation: bloquea explicando qué tiene, sin llegar a mirar Hermes', () => {
    const decision = decidirEliminacionCliente(local({ puedeBorrarse: false, ventas: 2, pedidos: 1, cotizaciones: 3, movimientosCaja: 4 }), null)
    expect(decision.kind).toBe('blocked')
    expect(decision.kind === 'blocked' && decision.reason).toContain('tiene historial')
    expect(decision.kind === 'blocked' && decision.reason).toContain('2 ventas')
    expect(decision.kind === 'blocked' && decision.reason).toContain('desactivarlo')
  })

  it('existe en Hermes: bloquea y remite al Conciliador', () => {
    const decision = decidirEliminacionCliente(local(), 'existe')
    expect(decision).toEqual({ kind: 'blocked', reason: 'Este cliente existe en Hermes. Hay que eliminarlo primero desde el Conciliador.' })
  })

  it('Hermes no disponible: bloquea igual, nunca se permite "por si acaso"', () => {
    const decision = decidirEliminacionCliente(local(), 'no-disponible')
    expect(decision.kind).toBe('blocked')
  })

  it('Hermes nunca se consultó (null) porque no hizo falta: también bloquea por seguridad', () => {
    const decision = decidirEliminacionCliente(local(), null)
    expect(decision.kind).toBe('blocked')
  })

  it('cliente que ya no existe localmente: bloquea sin ofrecer nada', () => {
    expect(decidirEliminacionCliente(local({ existe: false }), null)).toEqual({ kind: 'blocked', reason: 'Este cliente ya no existe.' })
  })
})
