import { Package, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { catalogoLocal } from '../../infrastructure/supabase/CatalogoLocal.supabase'

export interface FotosProducto { miniaturaUrl?: string; imagenUrl?: string }

/** Fotos de un producto desde el catálogo en memoria: cero peticiones por línea. */
export function fotosDeProducto(productoId: number | string | null | undefined): FotosProducto {
  if (productoId == null) return {}
  const id = Number(productoId)
  if (!Number.isFinite(id)) return {}
  const p = catalogoLocal.indice()?.productos.get(id)
  return p ? { miniaturaUrl: p.imagenMiniaturaUrl, imagenUrl: p.imagenUrl } : {}
}

/** Lo que se ve en la lista: la miniatura si existe; si no, la foto completa. */
export const urlMiniatura = (f: FotosProducto): string | undefined => f.miniaturaUrl ?? f.imagenUrl
/** Lo que se ve al agrandar: siempre la foto completa. */
export const urlCompleta = (f: FotosProducto): string | undefined => f.imagenUrl ?? f.miniaturaUrl

interface Props {
  nombre: string
  sku?: string | null
  /** Precio de lista para mostrar al agrandar (omitir si no aplica). */
  precio?: number | null
  /** Producto del catálogo: si no se dan las fotos, se buscan aquí. */
  productoId?: number | string | null
  miniaturaUrl?: string
  imagenUrl?: string
  /** Con acción, el visor ofrece este botón (p. ej. «Agregar a la venta»); sin ella dice «Listo, es este». */
  textoAccion?: string
  onAccion?: () => void
}

const bs = (v: number) => v.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Miniatura tocable de 52×52 con lupa; al tocarla abre la foto grande. Sin foto, un marcador neutro. */
export function FotoProductoPiso({ nombre, sku, precio, productoId, miniaturaUrl, imagenUrl, textoAccion, onAccion }: Props) {
  const [abierta, setAbierta] = useState(false)
  const buscadas = miniaturaUrl || imagenUrl ? {} : fotosDeProducto(productoId)
  const fotos: FotosProducto = { miniaturaUrl: miniaturaUrl ?? buscadas.miniaturaUrl, imagenUrl: imagenUrl ?? buscadas.imagenUrl }
  const lista = urlMiniatura(fotos)
  const completa = urlCompleta(fotos)
  if (!lista || !completa) return <span className="piso-foto piso-foto-vacia" aria-hidden="true"><Package /></span>
  return <>
    <button type="button" className="piso-foto" aria-label={`Ver foto de ${nombre}`} onClick={() => setAbierta(true)}>
      <img src={lista} alt="" loading="lazy" decoding="async" />
      <span className="piso-foto-lupa" aria-hidden="true"><Search /></span>
    </button>
    {abierta && <VisorFotoPiso nombre={nombre} sku={sku} precio={precio} url={completa} textoAccion={textoAccion} onAccion={onAccion} onClose={() => setAbierta(false)} />}
  </>
}

interface VisorProps { nombre: string; sku?: string | null; precio?: number | null; url: string; textoAccion?: string; onAccion?: () => void; onClose: () => void }

/** Pantalla oscura con la foto completa: se cierra con la «×», tocando fuera o con Escape. */
export function VisorFotoPiso({ nombre, sku, precio, url, textoAccion, onAccion, onClose }: VisorProps) {
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [onClose])
  const conAccion = Boolean(textoAccion && onAccion)
  return <div className="piso-visor" role="dialog" aria-modal="true" aria-label={`Foto de ${nombre}`} onClick={onClose}>
    <header onClick={(e) => e.stopPropagation()}>
      <div><strong>{nombre}</strong><small>{[sku, precio != null && precio > 0 ? `Bs ${bs(precio)}` : null].filter(Boolean).join(' · ')}</small></div>
      <button type="button" aria-label="Cerrar foto" onClick={onClose}><X /></button>
    </header>
    <div className="piso-visor-foto"><img src={url} alt={nombre} onClick={(e) => e.stopPropagation()} /></div>
    <footer onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => { if (conAccion) onAccion?.(); onClose() }}>{conAccion ? textoAccion : 'Listo, es este'}</button>
    </footer>
  </div>
}
