import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** QR impreso (nota de entrega / pedido) — 20mm mínimo con zona de silencio, generado
 * a dataURL en cliente (sin llamada a red). Ver domain/documents/qrContent.ts para el
 * contenido codificado. */
export function DocQr({ content, className, size = 160, resolution, margin = 1, onReady, onError }: { content: string; className?: string; size?: number; resolution?: number; margin?: number; onReady?: () => void; onError?: () => void }) {
  const [image, setImage] = useState<{ content: string; src: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    void QRCode.toDataURL(content, { margin, width: resolution || size, errorCorrectionLevel: 'M' }).then((url) => {
      if (!cancelled) setImage({ content, src: url })
    }).catch(() => { if (!cancelled) onError?.() })
    return () => { cancelled = true }
  }, [content, size, resolution, margin, onError])
  const cls = className ? `doc-qr ${className}` : 'doc-qr'
  // El tamaño por defecto lo fija el CSS de impresión (mm); solo un tamaño explícito pisa el estilo.
  const style = size !== 160 ? { width: size, height: size } : undefined
  if (image?.content !== content) return <div className={cls} style={style} aria-hidden />
  return <img className={cls} style={style} src={image.src} alt="Código QR del documento" onLoad={onReady} onError={onError} />
}
