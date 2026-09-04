import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** QR impreso (nota de entrega / pedido) — 20mm mínimo con zona de silencio, generado
 * a dataURL en cliente (sin llamada a red). Ver domain/documents/qrContent.ts para el
 * contenido codificado. */
export function DocQr({ content, className }: { content: string; className?: string }) {
  const [src, setSrc] = useState<string>('')
  useEffect(() => {
    let cancelled = false
    void QRCode.toDataURL(content, { margin: 1, width: 160, errorCorrectionLevel: 'M' }).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => { cancelled = true }
  }, [content])
  const cls = className ? `doc-qr ${className}` : 'doc-qr'
  if (!src) return <div className={cls} aria-hidden />
  return <img className={cls} src={src} alt="Código QR del documento" />
}
