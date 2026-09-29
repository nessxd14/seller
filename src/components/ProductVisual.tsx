import { useState } from 'react'
import { BookOpen, Box, FileArchive, FlaskConical, ImageOff, LoaderCircle, Maximize2, PenLine, Ruler, Scissors, StickyNote } from 'lucide-react'
import { Modal } from './Modal'

const icons = { cuaderno: BookOpen, archivador: FileArchive, boligrafo: PenLine, resma: StickyNote, silicona: FlaskConical, goma: Scissors, grapadora: Box, geometria: Ruler }

export function ProductVisual({ type, color, small = false, imagenUrl, expandable = false, name = 'Producto' }: { type: string; color: string; small?: boolean; imagenUrl?: string; expandable?: boolean; name?: string }) {
  const [imgFailed, setImgFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
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
      {expandable && showImage && <button className="product-image-expand" type="button" title="Agrandar imagen" aria-label={`Agrandar imagen de ${name}`} onClick={(event) => { event.stopPropagation(); setExpanded(true) }}><Maximize2 size={16} /></button>}
      {expanded && imagenUrl && <ProductImageViewer url={imagenUrl} name={name} onClose={() => setExpanded(false)} />}
    </div>
  )
}

function ProductImageViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  return <Modal title={name} subtitle="Imagen del producto" onClose={onClose} wide className="commercial-modal product-image-modal">
    <div className="modal-body product-image-stage" aria-busy={status === 'loading'}>
      {status === 'loading' && <div className="product-image-status" role="status"><LoaderCircle className="spin" /> Cargando imagen…</div>}
      {status === 'error' ? <div className="product-image-status" role="status"><ImageOff /> No se pudo cargar la imagen.</div> : <img src={url} alt={name} onLoad={() => setStatus('ready')} onError={() => setStatus('error')} style={{ opacity: status === 'ready' ? 1 : 0 }} />}
    </div>
    <footer className="modal-actions"><span className="image-viewer-hint">Imagen completa · Esc para cerrar</span><button className="secondary-button" onClick={onClose}>Cerrar imagen</button></footer>
  </Modal>
}
