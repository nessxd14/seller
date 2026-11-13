// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ArqueoProgramado } from '../../../../application/shared/models'

const h = vi.hoisted(() => ({ arqueos: vi.fn() }))
vi.mock('../../../../infrastructure/services', () => ({ turnoService: { arqueos: h.arqueos } }))
import { ArqueosDelTurno, ArqueosGerente, DesgloseCierre, etapasDeTurno } from '../ArqueosTurnoVistas'
import { semaforoDiferencia } from '../arqueoUi'

afterEach(cleanup)

const base = Date.parse('2026-11-13T14:00:00Z')
const MIN = 60_000
const a = (numero: number, offsetMin: number, extra: Partial<ArqueoProgramado> = {}): ArqueoProgramado => ({
  numero, programadoEn: new Date(base + offsetMin * MIN).toISOString(), venceEn: new Date(base + (offsetMin + 30) * MIN).toISOString(), estado: 'PROGRAMADO', ...extra,
})

describe('semaforoDiferencia', () => {
  it.each([[0, 'verde'], [0.99, 'verde'], [-0.99, 'verde'], [1, 'ambar'], [-9.99, 'ambar'], [10, 'rojo'], [-100, 'rojo']] as const)('%s → %s', (dif, luz) => {
    expect(semaforoDiferencia(dif)).toBe(luz)
  })
})

describe('ArqueosDelTurno (cajero)', () => {
  it('muestra solo horas y estado, nunca dinero', async () => {
    h.arqueos.mockResolvedValue({
      ahoraServidor: new Date(base).toISOString(),
      arqueos: [a(1, -60, { estado: 'CUMPLIDO' }), a(2, -5), a(3, 120)],
    })
    render(<ArqueosDelTurno sesionId="9" />)
    const fila = await screen.findByLabelText('Arqueos del turno')
    expect(fila.textContent).toContain('1 ·')
    expect(fila.textContent).toContain('✓')
    expect(fila.textContent).toContain('pendiente')
    expect(fila.textContent).not.toMatch(/Bs|esperado|diferencia/i)
  })

  it('no pinta nada si la lectura falla o no hay arqueos', async () => {
    h.arqueos.mockRejectedValue(new Error('x'))
    const { container, rerender } = render(<ArqueosDelTurno sesionId="9" />)
    await waitFor(() => expect(h.arqueos).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    h.arqueos.mockResolvedValue({ ahoraServidor: new Date(base).toISOString(), arqueos: [] })
    rerender(<ArqueosDelTurno sesionId="10" />)
    await waitFor(() => expect(h.arqueos).toHaveBeenCalledTimes(2))
    expect(container.textContent).toBe('')
  })
})

describe('ArqueosGerente', () => {
  const lineas = (...difs: number[]) => difs.map((d, i) => a(i + 1, i * 60, { estado: 'CUMPLIDO', contadoBs: 1000 + d, esperadoBs: 1000, diferenciaBs: d }))

  it.each([
    [0, 'Cuadró', 'verde'], [0.99, 'Cuadró', 'verde'], [-0.99, 'Cuadró', 'verde'],
    [-1, 'Faltó Bs 1,00', 'ambar'], [-7, 'Faltó Bs 7,00', 'ambar'], [-9.99, 'Faltó Bs 9,99', 'ambar'], [-10, 'Faltó Bs 10,00', 'rojo'], [-100, 'Faltó Bs 100,00', 'rojo'],
    [1, 'Sobró Bs 1,00', 'ambar'], [9.5, 'Sobró Bs 9,50', 'ambar'], [10, 'Sobró Bs 10,00', 'rojo'], [250, 'Sobró Bs 250,00', 'rojo'],
  ])('dif %s → "%s" (%s)', (dif, texto, tono) => {
    render(<ArqueosGerente ahoraMs={base} arqueos={lineas(dif)} />)
    expect(screen.getByText(texto).className).toContain(`es-${tono}`)
  })

  it('muestra contado, esperado, hora de respuesta, estado y desglose al expandir', () => {
    render(<ArqueosGerente ahoraMs={base} arqueos={[a(1, -60, { estado: 'CUMPLIDO_TARDE', respondidoEn: new Date(base - 20 * MIN).toISOString(), contadoBs: 1180.5, esperadoBs: 1280.5, diferenciaBs: -100, denominaciones: { '200': 2, '100': 5 } }), a(2, 90, { estado: 'CANCELADO' })]} />)
    expect(screen.getByText('tarde')).toBeTruthy()
    expect(screen.getByText('no tocaba')).toBeTruthy()
    expect(screen.getByText('Bs 1.180,50')).toBeTruthy()
    expect(screen.getByText('Bs 1.280,50')).toBeTruthy()
    expect(screen.getByText('Faltó Bs 100,00')).toBeTruthy()
    expect(screen.getByText(/2 × Bs 200 · 5 × Bs 100/)).toBeTruthy()
  })
})

describe('desglose de cierre', () => {
  it('arma apertura → arqueos → cierre con sus diferencias', () => {
    const etapas = etapasDeTurno({ aperturaBs: 500, diferenciaRelevoBs: 0, arqueos: [a(1, 0, { contadoBs: 900, diferenciaBs: 0.5 })], cierreContadoBs: 1500, cierreEsperadoBs: 1520 })
    expect(etapas.map((e) => e.etiqueta)).toEqual(['Apertura', 'Arqueo 1', 'Cierre'])
    expect(etapas[2]).toEqual({ etiqueta: 'Cierre', declaradoBs: 1500, diferenciaBs: -20 })
  })

  it('usa las mismas palabras que la vista en vivo', () => {
    render(<DesgloseCierre aperturaBs={500} diferenciaRelevoBs={0} arqueos={[a(1, 0, { contadoBs: 900, diferenciaBs: 3 })]} cierreContadoBs={1500} cierreEsperadoBs={1520} />)
    expect(screen.getByText('Cuadró')).toBeTruthy()
    expect(screen.getByText('Sobró Bs 3,00')).toBeTruthy()
    expect(screen.getByText('Faltó Bs 20,00').className).toContain('es-rojo')
  })

  it('si los arqueos no se pudieron leer, muestra "—" sin romper', () => {
    render(<DesgloseCierre aperturaBs={500} diferenciaRelevoBs={null} arqueos={null} cierreContadoBs={null} cierreEsperadoBs={null} />)
    expect(screen.getByText('Los arqueos del turno no se pudieron leer.')).toBeTruthy()
    expect(screen.getByText('Apertura')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
