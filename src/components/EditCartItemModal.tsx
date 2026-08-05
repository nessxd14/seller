import { useState } from 'react'
import { getPrice } from '../data/products'
import { usePos } from '../context/PosContext'
import type { CartItem } from '../types'
import { Modal } from './Modal'
import { NumberField } from './NumberField'

export function EditCartItemModal({ item, onClose }: { item: CartItem; onClose: () => void }) {
  const { channel, updateItem } = usePos()
  const [form, setForm] = useState<{ cantidad: number; precioAplicado: number; descuento: number; ubicacion: 'Tienda' | 'Almacén'; observacion: string; motivoPrecio: string }>({ cantidad: item.cantidad, precioAplicado: item.precioAplicado, descuento: item.descuento, ubicacion: item.ubicacion, observacion: item.observacion, motivoPrecio: item.motivoPrecio })
  const configured = getPrice(item, channel)
  // TAREA B: this modal also lets the seller edit precioAplicado directly (a second path
  // besides CartItem's inline editor) — it must set the same precioModificado flag or the
  // channel-switch freeze has a silent gap for lines priced through here.
  // TAREA 3 (Tanda 4): cantidad/precioAplicado/descuento ya llegan clampeados por
  // NumberField al confirmarse (min/max en el commit, no en cada tecla) — no hace
  // falta re-clampearlos acá.
  const save = () => { updateItem(item.id, { ...form, precioModificado: true, origenManual: true }); onClose() }
  return <Modal title="Editar línea" subtitle={item.nombre} onClose={onClose}><div className="modal-body form-grid">
    <label>Cantidad<NumberField value={form.cantidad} min={1} allowDecimals={false} onCommit={(cantidad) => setForm({ ...form, cantidad })} /></label>
    <label>Precio configurado<input value={`Bs ${configured.toFixed(2)}`} disabled /></label>
    <label>Precio aplicado<NumberField value={form.precioAplicado} min={0} step={0.5} onCommit={(precioAplicado) => setForm({ ...form, precioAplicado })} /></label>
    <label>Descuento (%)<NumberField value={form.descuento} min={0} max={100} onCommit={(descuento) => setForm({ ...form, descuento })} /></label>
    <label className="full">Ubicación de origen<select value={form.ubicacion} onChange={(e) => setForm({ ...form, ubicacion: e.target.value as 'Tienda' | 'Almacén' })}><option value="Tienda">Tienda</option><option value="Almacén">Almacén</option></select></label>
    <label className="full">Motivo del cambio de precio<select value={form.motivoPrecio} onChange={(e) => setForm({ ...form, motivoPrecio: e.target.value })}><option value="">Sin cambio de precio</option><option>Promoción autorizada</option><option>Precio acordado</option><option>Producto con detalle</option></select></label>
    <label className="full">Observación<textarea rows={3} placeholder="Añadir una nota a esta línea..." value={form.observacion} onChange={(e) => setForm({ ...form, observacion: e.target.value })} /></label>
  </div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={save}>Guardar cambios</button></footer></Modal>
}
