import { useState } from 'react'
import { Modal } from '../../../components/Modal'
import { NumberField } from '../../../components/NumberField'
import type { CambioPedido } from '../../../domain/orders/pedidoEdicion.types'

const UNIDADES = ['UNIDAD', 'METRO', 'KILO', 'LITRO', 'CAJA', 'PAQUETE'] as const

/** Ítem a pedido, sin producto de catálogo: descripción libre, unidad de medida, cantidad y precio. */
export function ItemPersonalizadoModal({ onAplicar, onClose }: { onAplicar: (cambio: CambioPedido) => void; onClose: () => void }) {
  const [descripcion, setDescripcion] = useState('')
  const [unidad, setUnidad] = useState<string>('UNIDAD')
  const [cantidad, setCantidad] = useState(1)
  const [precio, setPrecio] = useState(0)
  const valido = descripcion.trim().length > 0 && cantidad > 0 && precio > 0
  return <Modal title="Ítem personalizado" onClose={onClose} className="commercial-modal">
    <div className="modal-body form-grid">
      <label className="full">Descripción<input autoFocus value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Sello automático 40×60" /></label>
      <label>Unidad de medida<select value={unidad} onChange={(e) => setUnidad(e.target.value)}>{UNIDADES.map((u) => <option key={u} value={u}>{u.charAt(0) + u.slice(1).toLowerCase()}</option>)}</select></label>
      <label>Cantidad<NumberField ariaLabel="Cantidad del ítem personalizado" min={0} step="any" value={cantidad} onCommit={setCantidad} /></label>
      <label>Precio (Bs)<NumberField ariaLabel="Precio del ítem personalizado" min={0} step={0.01} value={precio} onCommit={setPrecio} /></label>
    </div>
    <footer className="modal-actions ped-pie-modal">
      <button type="button" className="ped-btn ped-btn-suave" onClick={onClose}>Cancelar</button>
      <button type="button" className="ped-btn ped-btn-primario" disabled={!valido} onClick={() => onAplicar({ op: 'agregar', producto_id: null, presentacion_id: null, cantidad_presentacion: cantidad, precio_unitario: precio, descuento_pct: 0, es_personalizado: true, descripcion: descripcion.trim(), unidad_medida: unidad, faltante: null })}>Agregar a la edición</button>
    </footer>
  </Modal>
}
