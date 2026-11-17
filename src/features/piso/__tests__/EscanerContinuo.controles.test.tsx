// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EscanerContinuo } from '../EscanerContinuo'

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  const track = { getCapabilities: () => ({ torch: true }), applyConstraints: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
  HTMLMediaElement.prototype.play = () => Promise.resolve()
  class Detector { static getSupportedFormats = () => Promise.resolve(['ean_13']); detect = () => Promise.resolve([]) }
  vi.stubGlobal('BarcodeDetector', Detector)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('EscanerContinuo — controles dentro de la cámara', () => {
  it('muestra la linterna (si el teléfono la tiene) y el cierre dentro del visor, y los dispara', async () => {
    const onLinterna = vi.fn()
    const onCerrar = vi.fn()
    const { container } = render(<EscanerContinuo onCodigo={vi.fn()} plegado={false} linterna={false} onLinterna={onLinterna} onCerrar={onCerrar} />)
    const camara = container.querySelector('.piso-camara') as HTMLElement
    const linterna = await within(camara).findByRole('button', { name: 'Encender linterna' })
    fireEvent.click(linterna)
    expect(onLinterna).toHaveBeenCalledWith(true)
    fireEvent.click(within(camara).getByRole('button', { name: 'Cerrar cámara' }))
    expect(onCerrar).toHaveBeenCalled()
  })

  it('sin onCerrar ni onLinterna no pinta botones (Venta móvil)', async () => {
    const { container } = render(<EscanerContinuo onCodigo={vi.fn()} plegado={false} linterna={false} />)
    await waitFor(() => expect(container.querySelector('video')).toBeTruthy())
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('plegado no pinta nada', () => {
    const { container } = render(<EscanerContinuo onCodigo={vi.fn()} plegado linterna={false} onCerrar={vi.fn()} />)
    expect(container.querySelector('.piso-camara')).toBeNull()
  })

  it('la tira inferior muestra la última lectura', () => {
    render(<EscanerContinuo onCodigo={vi.fn()} plegado={false} linterna={false} retro="✓ Pegamento UHU 21 g · ahora 2" />)
    expect(screen.getByRole('status').textContent).toBe('✓ Pegamento UHU 21 g · ahora 2')
  })
})
