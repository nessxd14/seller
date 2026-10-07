import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Modal } from './Modal'
import { ventaDirectaService } from '../infrastructure/services'
import type { VtdPorCobrar } from '../application/shared/models'

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Brief Caja VTD tarea 3: bandeja de "Agregar VTD" — lista v_vtd_por_cobrar, filtrable por
 * número o cliente (type-ahead, nunca tipear un número de memoria: por eso arranca con la
 * lista completa en vez de un campo vacío que obliga a escribir).
 */
export function CobrarVtdPickerModal({ yaSeleccionadas, onClose, onAdd }: { yaSeleccionadas: string[]; onClose: () => void; onAdd: (ventas: VtdPorCobrar[]) => void }) {
  const [ventas, setVentas] = useState<VtdPorCobrar[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())

  useEffect(() => {
    void ventaDirectaService.listPorCobrar().then(setVentas).catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar la lista de VTD por cobrar'))
  }, [])

  const disponibles = useMemo(() => (ventas ?? []).filter((v) => !yaSeleccionadas.includes(v.ventaId)), [ventas, yaSeleccionadas])
  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return disponibles
    return disponibles.filter((v) => (v.numero ?? '').toLowerCase().includes(q) || (v.clienteNombre ?? '').toLowerCase().includes(q))
  }, [disponibles, query])

  const toggle = (id: string) => setChecked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const confirmar = () => {
    const seleccionadas = disponibles.filter((v) => checked.has(v.ventaId))
    if (!seleccionadas.length) return
    onAdd(seleccionadas)
  }

  return (
    <Modal title="Agregar VTD" subtitle="Venta directa postcobrada — seleccioná una o más para cobrar" onClose={onClose} wide>
      <div className="modal-body vtd-cobro-picker">
        <label className="vtd-cobro-search"><Search size={14} /><input autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por número o cliente…" /></label>
        {error && <p className="mock-note payment-error">{error}</p>}
        {ventas === null
          ? <p className="mock-note">Cargando…</p>
          : filtradas.length
            ? <ul className="vtd-cobro-lista">
                {filtradas.map((v) => (
                  <li key={v.ventaId}>
                    <label>
                      <input type="checkbox" checked={checked.has(v.ventaId)} onChange={() => toggle(v.ventaId)} />
                      <span className="vtd-cobro-item-info">
                        <strong>{v.numero ?? `#${v.ventaId}`}</strong>
                        <span>{v.clienteNombre ?? 'Cliente de mostrador'}</span>
                        <span className={`vtd-modo-tag ${v.estado === 'COMPLETADA' ? 'pagado' : 'por-cobrar'}`}>{v.estado === 'COMPLETADA' ? 'Entregada' : 'Por entregar'}</span>
                        {v.pagoPosterior && <span className="vtd-modo-tag pago-posterior">Pago posterior</span>}
                        {v.pagoPosterior && (v.pagoPosteriorContacto || v.pagoPosteriorMotivo) && <span className="vtd-cobro-posterior-info">{[v.pagoPosteriorContacto, v.pagoPosteriorMotivo].filter(Boolean).join(' · ')}</span>}
                      </span>
                      <b>Bs {bs(v.totalBs)}</b>
                    </label>
                  </li>
                ))}
              </ul>
            : <p className="mock-note">No hay VTD por cobrar{query ? ' que coincidan con la búsqueda' : ''}.</p>}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" disabled={!checked.size} onClick={confirmar}>Agregar {checked.size > 0 ? `(${checked.size})` : ''}</button>
      </footer>
    </Modal>
  )
}
