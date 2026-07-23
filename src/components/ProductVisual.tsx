import { BookOpen, Box, FileArchive, FlaskConical, PenLine, Ruler, Scissors, StickyNote } from 'lucide-react'

const icons = { cuaderno: BookOpen, archivador: FileArchive, boligrafo: PenLine, resma: StickyNote, silicona: FlaskConical, goma: Scissors, grapadora: Box, geometria: Ruler }

export function ProductVisual({ type, color, small = false }: { type: string; color: string; small?: boolean }) {
  const Icon = icons[type as keyof typeof icons] ?? Box
  return <div className={`product-visual ${small ? 'small' : ''}`} style={{ '--product-color': color } as React.CSSProperties}><span className="visual-glow" /><Icon strokeWidth={1.55} /></div>
}
