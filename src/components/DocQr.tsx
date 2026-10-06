import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** QR impreso (nota de entrega / pedido) — 20mm mínimo con zona de silencio, generado
 * a dataURL en cliente (sin llamada a red). Ver domain/documents/qrContent.ts para el
 * contenido codificado. */
export function DocQr({ content, className, size = 160 }: { content: string; className?: string; size?: number }) {
  const [src, setSrc] = useState<string>('')
  useEffect(() => {
    let cancelled = false
    void QRCode.toDataURL(content, { margin: 1, width: size, errorCorrectionLevel: 'M' }).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => { cancelled = true }
  }, [content, size])
  const cls = className ? `doc-qr ${className}` : 'doc-qr'
  // El tamaño por defecto lo fija el CSS de impresión (mm); solo un tamaño explícito pisa el estilo.
  const style = size !== 160 ? { width: size, height: size } : undefined
  if (!src) return <div className={cls} style={style} aria-hidden />
  return <img className={cls} style={style} src={src} alt="Código QR del documento" />
}
