import { ArrowLeft, ScanLine, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { TransferRecord } from '../../application/shared/models'
import { AmbiguousScanPicker } from '../../components/AmbiguousScanPicker'
import { ALMACEN_CENTRAL_ID, nombreSucursalPiso } from '../../domain/sales/trasladoPiso'
import { mensajeErrorTraslado } from '../../domain/sales/transfers'
import { getStockBySucursalBatch, listPresentations, productRepository, transferService } from '../../infrastructure/services'
import type { Product } from '../../types'
import { EscanerContinuo, vibrarDesconocido } from './EscanerContinuo'
import { StepperPiso } from './StepperPiso'

interface Presentacion { id: number; nombre: string; esBase: boolean }
interface LineaPedido { productId: string; name: string; sku: string; cantidad: number; presentacionId?: number; presentacionNombre?: string }
interface StockLinea { tienda: number; almacen: number }

const fmt = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 })

interface Props {
  /** Sucursal del reponedor: destino fijo del pedido. */
  sucursalId: number
  onVolver: () => void
  onCreado: (traslado: TransferRecord) => void
  aviso: (mensaje: string) => void
}

export function PedirTrasladoPiso({ sucursalId, onVolver, onCreado, aviso }: Props) {
  const [lineas, setLineas] = useState<LineaPedido[]>([])
  const [presentaciones, setPresentaciones] = useState<Record<string, Presentacion[]>>({})
  const [stock, setStock] = useState<Record<string, StockLinea>>({})
  const [nota, setNota] = useState('')
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Product[]>([])
  const [escaneando, setEscaneando] = useState(false)
  const [ambiguos, setAmbiguos] = useState<number[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = texto.trim()
    if (!q) return
    let cancelado = false
    const id = window.setTimeout(() => {
      productRepository.search({ query: q, active: true, page: { page: 1, pageSize: 20 } })
        .then((page) => { if (!cancelado) setResultados(page.items) })
        .catch(() => { if (!cancelado) setError('No se pudo buscar. Reintenta.') })
    }, 250)
    return () => { cancelado = true; window.clearTimeout(id) }
  }, [texto])

  const cambiar = (productId: string, parche: Partial<LineaPedido>) => setLineas((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...parche } : l)))

  const agregar = useCallback((producto: Product) => {
    const productId = String(producto.id)
    setTexto(''); setResultados([]); setError('')
    setLineas((prev) => prev.some((l) => l.productId === productId)
      ? prev.map((l) => (l.productId === productId ? { ...l, cantidad: l.cantidad + 1 } : l))
      : [...prev, { productId, name: producto.nombre, sku: producto.sku, cantidad: 1 }])
    void listPresentations(producto.id).then((lista) => {
      setPresentaciones((prev) => ({ ...prev, [productId]: lista }))
    }).catch(() => setError('No se pudieron cargar las presentaciones. Vuelve a agregar el producto.'))
    // Mejor esfuerzo: si el stock falla, la línea se queda sin esa referencia.
    getStockBySucursalBatch([producto.id]).then((lote) => {
      const s = lote.get(producto.id)
      if (s) setStock((prev) => ({ ...prev, [productId]: { tienda: s.tiendaVendible, almacen: s.almacenVendible } }))
    }).catch(() => {})
    aviso(`Agregado: ${producto.nombre}`)
  }, [aviso])

  const alEscanear = async (codigo: string) => {
    try {
      const r = await productRepository.resolveScannedCode(codigo)
      if (r.kind === 'found') agregar(r.product)
      else if (r.kind === 'ambiguous') { vibrarDesconocido(); setAmbiguos(r.productIds) }
      else { vibrarDesconocido(); aviso('Código no reconocido') }
    } catch (e) { aviso(mensajeErrorTraslado(e, 'No se pudo leer el código')) }
  }

  const valido = lineas.length > 0 && lineas.every((l) => Number.isFinite(l.cantidad) && l.cantidad > 0)
  const pedir = async () => {
    if (!valido || enviando) return
    setEnviando(true); setError('')
    try {
      const creado = await transferService.create({
        motivo: 'REPOSICION',
        nota: nota.trim() || undefined,
        sucursalOrigenId: ALMACEN_CENTRAL_ID,
        sucursalDestinoId: sucursalId,
        lines: lineas.map((l) => ({
          productId: l.productId,
          ...(l.presentacionId != null ? { presentacionId: l.presentacionId, cantidadPresentacion: l.cantidad } : { cantidadBase: l.cantidad }),
        })),
      })
      onCreado(creado)
    } catch (e) { setError(mensajeErrorTraslado(e, 'No se pudo crear el pedido')) } finally { setEnviando(false) }
  }

  return <>
    <header className="piso-header">
      <button type="button" className="piso-icono" aria-label="Volver a Traslados" onClick={onVolver}><ArrowLeft /></button>
      <div><h1>Pedir a almacén</h1><small>{nombreSucursalPiso(ALMACEN_CENTRAL_ID)} → {nombreSucursalPiso(sucursalId)}</small></div>
    </header>
    <section className="traslado-cuerpo traslado-cuerpo-pie" aria-label="Productos a pedir">
      <div className="piso-captura traslado-captura">
        <button type="button" className="piso-plegar" aria-expanded={escaneando} onClick={() => setEscaneando((v) => !v)}><ScanLine /> {escaneando ? 'Ocultar cámara' : 'Escanear'}</button>
        {escaneando && <EscanerContinuo onCodigo={(c) => void alEscanear(c)} plegado={false} linterna={false} onSoporteLinterna={() => {}} />}
        <div className="piso-buscador">
          <label><Search aria-hidden="true" /><input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" placeholder="Buscar por nombre o código" aria-label="Buscar producto" value={texto} onChange={(e) => setTexto(e.target.value)} /></label>
          {texto.trim() && <ul className="piso-resultados">
            {resultados.map((p) => <li key={p.id}><button type="button" onClick={() => agregar(p)}><strong>{p.nombre}</strong><small>{p.sku}</small></button></li>)}
          </ul>}
        </div>
      </div>
      {!lineas.length && <p className="piso-vacio">Escanea un código o busca un producto para pedirlo.</p>}
      {lineas.map((l) => {
        const lista = presentaciones[l.productId] ?? []
        const s = stock[l.productId]
        return <article key={l.productId} className="traslado-linea">
          <div className="piso-linea-nombre"><strong>{l.name}</strong><small>{s ? `En tienda: ${fmt(s.tienda)} · En almacén: ${fmt(s.almacen)}` : l.sku}</small></div>
          <button type="button" className="piso-quitar" aria-label={`Quitar ${l.name}`} onClick={() => setLineas((prev) => prev.filter((x) => x.productId !== l.productId))}><Trash2 /></button>
          <StepperPiso etiqueta={`Cantidad ${l.name}`} valor={l.cantidad} min={1} onCambio={(n) => cambiar(l.productId, { cantidad: n })} />
          {lista.length > 1 && <select className="demanda-select" aria-label={`Presentación ${l.name}`} value={l.presentacionId ?? lista.find((p) => p.esBase)?.id ?? lista[0].id}
            onChange={(e) => { const p = lista.find((x) => x.id === Number(e.target.value)); if (p) cambiar(l.productId, { presentacionId: p.esBase ? undefined : p.id, presentacionNombre: p.esBase ? undefined : p.nombre }) }}>
            {lista.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>}
        </article>
      })}
      <label className="piso-campo">Nota (opcional)<input className="piso-input" type="text" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} placeholder="Para el almacenero" /></label>
      <p className="piso-nota-rol">Al pedir sale un ticket con QR. El almacenero lo usa para alistar y tú para recibir.</p>
      {error && <p className="piso-error" role="alert">{error}</p>}
    </section>
    <footer className="piso-pie">
      <div><span>{lineas.length} {lineas.length === 1 ? 'producto' : 'productos'}</span></div>
      <button type="button" className="piso-enviar" disabled={!valido || enviando} onClick={() => void pedir()}>{enviando ? 'Pidiendo…' : 'Pedir a almacén'}</button>
    </footer>
    {ambiguos && <AmbiguousScanPicker productIds={ambiguos} onPick={(p) => { setAmbiguos(null); agregar(p) }} onClose={() => setAmbiguos(null)} />}
  </>
}
