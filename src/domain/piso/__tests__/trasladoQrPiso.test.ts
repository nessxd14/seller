import { describe, expect, it } from 'vitest'
import type { TrasladoPiso } from '../../../application/ports/pisoRepository'
import { ETIQUETA_PILDORA_QR, TONO_PILDORA_QR, detalleTrasladoPiso, pildoraTrasladoPiso, seccionTrasladoPiso, tieneQrAbierto } from '../trasladoQrPiso'

const t = (o: Partial<TrasladoPiso>): TrasladoPiso => ({
  id: '88', numero: 'TRA-2026-00088', estado: 'SOLICITADO', motivo: 'REPOSICION', origenId: 1, destinoId: 2, solicitadoEn: '2026-11-16T15:00:00Z',
  mio: false, nota: null, tareaEstado: null, alista: null, alistadoEn: null, retira: null, retiroMio: false, recibidoEn: null, lineas: 3, conFaltante: false, ...o,
})

describe('traslados del piso: pastilla, sección y detalle', () => {
  const casos: Array<[string, Partial<TrasladoPiso>, string, string, 'retirar' | 'recibir' | 'pedidos']> = [
    ['pedido sin tarea', {}, 'Pedido', 'gris', 'pedidos'],
    ['en alistado', { tareaEstado: 'PREPARANDO', alista: 'Beto' }, 'En alistado', 'azul', 'pedidos'],
    ['listo para retirar', { tareaEstado: 'PREPARADO', alista: 'Beto' }, 'Listo para retirar', 'ambar', 'retirar'],
    ['retirando', { tareaEstado: 'REVISANDO', retira: 'Ana' }, 'Retirando', 'ambar', 'retirar'],
    ['recibido', { tareaEstado: 'RECIBIDO', estado: 'RECIBIDO' }, 'Recibido', 'verde', 'pedidos'],
    ['con faltante', { tareaEstado: 'RECIBIDO', estado: 'RECIBIDO', conFaltante: true }, 'Con faltante', 'rojo', 'pedidos'],
    ['cancelado', { estado: 'CANCELADO' }, 'Cancelado', 'gris', 'pedidos'],
    ['rechazado', { estado: 'RECHAZADO', tareaEstado: 'PREPARANDO' }, 'Cancelado', 'gris', 'pedidos'],
    ['flujo viejo en tránsito', { estado: 'EN_TRANSITO' }, 'En camino', 'ambar', 'recibir'],
  ]
  it.each(casos)('%s', (_n, o, etiqueta, tono, seccion) => {
    const x = t(o)
    expect(ETIQUETA_PILDORA_QR[pildoraTrasladoPiso(x)]).toBe(etiqueta)
    expect(TONO_PILDORA_QR[pildoraTrasladoPiso(x)]).toBe(tono)
    expect(seccionTrasladoPiso(x)).toBe(seccion)
  })

  it('el QR solo aparece en los abiertos', () => {
    expect(tieneQrAbierto(t({}))).toBe(true)
    expect(tieneQrAbierto(t({ tareaEstado: 'REVISANDO' }))).toBe(true)
    expect(tieneQrAbierto(t({ tareaEstado: 'RECIBIDO', estado: 'RECIBIDO' }))).toBe(false)
    expect(tieneQrAbierto(t({ estado: 'CANCELADO' }))).toBe(false)
  })

  it('textos de detalle', () => {
    expect(detalleTrasladoPiso(t({}))).toMatch(/^Pedido \d{2}:\d{2} · almacén aún no lo toma$/)
    expect(detalleTrasladoPiso(t({ tareaEstado: 'PREPARANDO', alista: 'Beto' }))).toBe('Beto lo está alistando')
    expect(detalleTrasladoPiso(t({ tareaEstado: 'PREPARADO', alista: 'Beto', alistadoEn: '2026-11-16T16:00:00Z', mio: true }))).toMatch(/^Alistó Beto a las \d{2}:\d{2} · lo pediste tú$/)
    expect(detalleTrasladoPiso(t({ tareaEstado: 'PREPARADO', alista: 'Beto', alistadoEn: '2026-11-16T16:00:00Z' }))).not.toMatch(/lo pediste tú/)
    expect(detalleTrasladoPiso(t({ tareaEstado: 'REVISANDO', retira: 'Ana' }))).toBe('Ana está comprobando')
    expect(detalleTrasladoPiso(t({ tareaEstado: 'REVISANDO', retira: 'Ana', retiroMio: true }))).toBe('Lo estás comprobando tú')
  })
})
