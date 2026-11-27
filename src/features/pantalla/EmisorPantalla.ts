import { construirEstado, type ConstruirEstadoEntrada } from '../../domain/pantalla/pantallaCliente'
import { abrirEmisor, type PantallaEmisorTransporte } from './transporte'

export const PANTALLA_DEBOUNCE_MS = 120
export const PANTALLA_LATIDO_ACTIVO_MS = 10_000
export const PANTALLA_LATIDO_REPOSO_MS = 30_000

/** Lo que cambia entre envíos; seq, emisorId, cajaId y ts los pone el emisor. */
export type PantallaSnapshot = Omit<ConstruirEstadoEntrada, 'cajaId' | 'seq' | 'emisorId' | 'ts'>

const avisar = (contexto: string, error: unknown) => console.warn(`[pantalla-cliente] ${contexto}`, error)

/**
 * Emite snapshots completos de una caja. Nunca lanza hacia el POS: cualquier error de Realtime se
 * registra con console.warn y el flujo del cajero sigue igual aunque la tablet esté apagada.
 */
export class EmisorPantalla {
  private transporte: PantallaEmisorTransporte | null = null
  private ultimo: PantallaSnapshot | null = null
  private seq = 0
  private cerrado = false
  private debounce: ReturnType<typeof setTimeout> | null = null
  private latido: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly cajaId: number,
    private readonly emisorId: string,
    abrir: (cajaId: number) => Promise<PantallaEmisorTransporte> = abrirEmisor,
  ) {
    let apertura: Promise<PantallaEmisorTransporte>
    try { apertura = abrir(cajaId) } catch (error) { avisar('no se pudo abrir el canal', error); return }
    void apertura.then((transporte) => {
      if (this.cerrado) { transporte.cerrar(); return }
      this.transporte = transporte
      // Con un envío ya agendado (debounce) no se duplica: sale con él.
      if (this.ultimo && !this.debounce) this.enviarAhora()
    }).catch((error) => avisar('no se pudo abrir el canal', error))
  }

  /** Registra el estado actual y lo envía tras 120 ms (se funden varios cambios seguidos). */
  actualizar(snapshot: PantallaSnapshot): void {
    if (this.cerrado) return
    this.ultimo = snapshot
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => { this.debounce = null; this.enviarAhora() }, PANTALLA_DEBOUNCE_MS)
  }

  private armar(snapshot: PantallaSnapshot) {
    return construirEstado({ ...snapshot, cajaId: this.cajaId, emisorId: this.emisorId, seq: ++this.seq })
  }

  private enviarAhora(): void {
    if (this.latido) { clearTimeout(this.latido); this.latido = null }
    const snapshot = this.ultimo
    const transporte = this.transporte
    if (this.cerrado || !snapshot || !transporte) return
    try {
      void transporte.enviar(this.armar(snapshot)).catch((error) => avisar('envío falló', error))
    } catch (error) { avisar('envío falló', error) }
    // Latido: reenvía el último snapshot (10 s con venta o cobro, 30 s en reposo).
    this.latido = setTimeout(() => { this.latido = null; this.enviarAhora() }, snapshot.fase === 'reposo' ? PANTALLA_LATIDO_REPOSO_MS : PANTALLA_LATIDO_ACTIVO_MS)
  }

  /** Cierra la caja de la sesión: manda reposo y suelta el canal. */
  cerrar(): void {
    if (this.cerrado) return
    this.cerrado = true
    if (this.debounce) clearTimeout(this.debounce)
    if (this.latido) clearTimeout(this.latido)
    this.debounce = this.latido = null
    const transporte = this.transporte
    this.transporte = null
    if (!transporte) return
    try {
      const reposo = this.armar({ fase: 'reposo', carrito: [], subtotal: 0, total: 0 })
      void transporte.enviar(reposo).catch((error) => avisar('reposo final falló', error)).finally(() => transporte.cerrar())
    } catch (error) { avisar('cierre falló', error); transporte.cerrar() }
  }
}
