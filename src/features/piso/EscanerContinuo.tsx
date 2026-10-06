import { useEffect, useRef, useState } from 'react'
import { aceptarLectura, type LecturasRecientes } from '../../domain/sales/pedidoPiso'

/** ITF solo se acepta con 14 dígitos: las lecturas más cortas casi siempre son un error de lectura. */
export const ITF_LENGTHS = [14]
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']
const INTERVALO_MS = 110 // ~9 lecturas por segundo

/** Un valor leído es válido salvo un ITF con largo no admitido. */
export const lecturaValida = (format: string, rawValue: string): boolean => rawValue.length > 0 && (format !== 'itf' || ITF_LENGTHS.includes(rawValue.length))

export const vibrar = (patron: number | number[]) => { try { navigator.vibrate?.(patron) } catch { /* sin vibración */ } }
export const vibrarDesconocido = () => vibrar([60, 40, 60])

const mensajeDeError = (error: unknown): string => {
  const nombre = error instanceof DOMException ? error.name : ''
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return 'No diste permiso a la cámara. Puedes seguir buscando por texto.'
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError' || nombre === 'DevicesNotFoundError') return 'Este teléfono no tiene una cámara disponible. Busca por texto.'
  if (nombre === 'NotReadableError') return 'La cámara está en uso por otra aplicación. Ciérrala o busca por texto.'
  return 'No se pudo abrir la cámara. Puedes seguir buscando por texto.'
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

/** Mantiene la pantalla encendida mientras la página esté visible; la vuelve a pedir al regresar. */
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let cancelado = false
    const pedir = async () => {
      if (document.visibilityState !== 'visible' || lock) return
      try { const l = await navigator.wakeLock?.request('screen'); if (cancelado) void l?.release(); else lock = l ?? null; lock?.addEventListener('release', () => { lock = null }) } catch { /* no soportado o denegado */ }
    }
    void pedir()
    const onChange = () => { void pedir() }
    document.addEventListener('visibilitychange', onChange)
    return () => { cancelado = true; document.removeEventListener('visibilitychange', onChange); void lock?.release(); lock = null }
  }, [])
}

/**
 * Visor de cámara que se queda abierto y sigue leyendo: nunca se cierra tras una lectura.
 * Se pausa (y suelta la cámara) con la página oculta, con el visor plegado y al desmontar.
 */
export function EscanerContinuo({ onCodigo, plegado, linterna, onSoporteLinterna }: {
  onCodigo: (codigo: string) => void
  plegado: boolean
  linterna: boolean
  onSoporteLinterna?: (soportada: boolean) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const recientes = useRef<LecturasRecientes>({})
  const onCodigoRef = useRef(onCodigo)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [destello, setDestello] = useState(false)
  const visible = useVisible()
  const activo = visible && !plegado

  useEffect(() => { onCodigoRef.current = onCodigo }, [onCodigo])

  useEffect(() => {
    if (!activo) return
    let detenido = false
    let limpiar: () => void = () => undefined

    const aceptar = (format: string, raw: string) => {
      if (!lecturaValida(format, raw)) return
      const r = aceptarLectura(recientes.current, raw, Date.now())
      recientes.current = r.recientes
      if (!r.aceptada) return
      vibrar(40)
      setDestello(true)
      window.setTimeout(() => setDestello(false), 160)
      onCodigoRef.current(raw)
    }

    const iniciar = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError('La cámara solo funciona en una conexión segura (https). Busca por texto.'); return }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } })
      } catch (e) { if (!detenido) setError(mensajeDeError(e)); return }
      if (detenido) { stream.getTracks().forEach((t) => t.stop()); return }
      setError('')
      const track = stream.getVideoTracks()[0]
      trackRef.current = track ?? null
      onSoporteLinterna?.(Boolean(track?.getCapabilities?.().torch))
      const video = videoRef.current
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return }
      video.srcObject = stream
      void video.play().catch(() => undefined)
      const soltar = () => { stream.getTracks().forEach((t) => t.stop()); trackRef.current = null; if (video.srcObject === stream) video.srcObject = null }

      if (typeof BarcodeDetector !== 'undefined') {
        const soportados = await BarcodeDetector.getSupportedFormats().catch(() => FORMATOS)
        const detector = new BarcodeDetector({ formats: FORMATOS.filter((f) => soportados.includes(f)) })
        let leyendo = false
        const id = window.setInterval(() => {
          if (leyendo || video.readyState < 2) return
          leyendo = true
          detector.detect(video).then((codigos) => { for (const c of codigos) aceptar(c.format, c.rawValue) }).catch(() => undefined).finally(() => { leyendo = false })
        }, INTERVALO_MS)
        limpiar = () => { window.clearInterval(id); soltar() }
      } else {
        setAviso('Para escanear más rápido, abre esta página en Chrome')
        try {
          // Respaldo: ZXing se carga solo cuando hace falta, fuera del bundle principal.
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
          if (detenido) { soltar(); return }
          const hints = new Map<import('@zxing/library').DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF]]])
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: INTERVALO_MS, delayBetweenScanSuccess: INTERVALO_MS })
          const controles = await reader.decodeFromStream(stream, video, (resultado) => {
            if (!resultado) return
            const formato = BarcodeFormat[resultado.getBarcodeFormat()]?.toLowerCase() ?? ''
            aceptar(formato, resultado.getText())
          })
          limpiar = () => { controles.stop(); soltar() }
          if (detenido) limpiar()
        } catch { limpiar = soltar; setError('No se pudo iniciar el lector. Busca por texto.') }
      }
    }
    void iniciar()
    return () => { detenido = true; limpiar() }
  }, [activo, onSoporteLinterna])

  useEffect(() => {
    const track = trackRef.current
    if (!activo || !track?.getCapabilities?.().torch) return
    void track.applyConstraints({ advanced: [{ torch: linterna }] }).catch(() => undefined)
  }, [linterna, activo])

  if (plegado) return null
  return <div className={`piso-visor ${destello ? 'destello' : ''}`}>
    {error
      ? <p className="piso-visor-error" role="alert">{error}</p>
      : <video ref={videoRef} playsInline muted aria-label="Cámara para escanear códigos de barras" />}
    {!error && aviso && <p className="piso-visor-aviso">{aviso}</p>}
  </div>
}
