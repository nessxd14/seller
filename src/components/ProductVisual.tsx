import { useState } from 'react'
import { BookOpen, Box, FileArchive, FlaskConical, PenLine, Ruler, Scissors, StickyNote } from 'lucide-react'

const icons = { cuaderno: BookOpen, archivador: FileArchive, boligrafo: PenLine, resma: StickyNote, silicona: FlaskConical, goma: Scissors, grapadora: Box, geometria: Ruler }

export function ProductVisual({ type, color, small = false, imagenUrl }: { type: string; color: string; small?: boolean; imagenUrl?: string }) {
  const [imgFailed, setImgFailed] = useState(false)
  const Icon = icons[type as keyof typeof icons] ?? Box
  const showImage = Boolean(imagenUrl) && !imgFailed
  return (
    <div className={`product-visual ${small ? 'small' : ''}`} style={{ '--product-color': color } as React.CSSProperties}>
      {showImage ? (
        <img src={imagenUrl} alt="" loading="lazy" className="product-visual-img" onError={() => setImgFailed(true)} />
      ) : (
        <>
          <span className="visual-glow" />
          <Icon strokeWidth={1.55} />
        </>
      )}
    </div>
  )
}
