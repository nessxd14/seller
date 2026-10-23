import { useState } from 'react'
import { Modal } from '../../../components/Modal'
import { NumberField } from '../../../components/NumberField'
import type { ItemBorrador } from '../../../domain/orders/edicionPedido'
import type { CambioPedido } from '../../../domain/orders/pedidoEdicion.types'
import { precioSugerido } from '../../../domain/pricing/precioPresentacion'
import { listPresentations } from '../../../infrastructure/services'
import type { Product, SalesChannel } from '../../../types'
import { bs, cant } from '../detalle/formato'
import { BuscadorProducto } from './BuscadorProducto'
import { priceForOrderChannel } from './canal'

/** Reemplaza lo que Almacén no pudo cubrir por otro producto, con su propio precio. */
export function ProductoSaldoModal({ item, canal, onAplicar, onClose }: { item: ItemBorrador; canal: SalesChannel; onAplicar: (cambio: CambioPedido) => void; onClose: () => void }) {
  const [producto, setProducto] = useState<{ id: number; nombre: string; presentacionId: number | null } | null>(null)
  const [precio, setPrecio] = useState(0)

  const elegir = async (elegido: Product) => {
    const presentaciones = await listPresentations(elegido.id)
    const presentacion = presentaciones.find((p) => p.esBase) ?? presentaciones[0]
    setProducto({ id: elegido.id, nombre: elegido.nombre, presentacionId: presentacion?.id || null })
    setPrecio(precioSugerido(presentacion, canal, priceForOrderChannel(elegido, canal)) ?? priceForOrderChannel(elegido, canal))
  }

  return <Modal title="Cambiar producto del saldo" subtitle={item.descripcion} onClose={onClose} className="commercial-modal">
    <div className="modal-body">
      <p className="ped-intro">Las {cant(item.cantidad_sin_cubrir)} u sin cubrir de <strong>{item.descripcion}</strong> pasan a otro producto, con su propio precio. Lo ya surtido de {item.descripcion} no cambia.</p>
      {producto && <p className="ped-solo-lectura"><strong>{producto.nombre}</strong> × {cant(item.cantidad_sin_cubrir)}</p>}
      <BuscadorProducto canal={canal} etiqueta={producto ? 'Elegir otro producto' : 'Buscar producto'} autoFocus onElegir={(p) => void elegir(p)} />
      {producto && <label className="ped-campo"><span className="ped-campo-etiqueta">Precio (Bs)</span>
        <NumberField ariaLabel="Precio del producto del saldo" min={0} step={0.01} value={precio} onCommit={setPrecio} />
      </label>}
      {producto && <p className="ped-ficha"><span>Importe del saldo</span><strong>{bs(precio * item.cantidad_sin_cubrir)}</strong></p>}
    </div>
    <footer className="modal-actions ped-pie-modal">
      <small>Se suma a tu edición. Se guarda recién al confirmar.</small>
      <button type="button" className="ped-btn ped-btn-suave" onClick={onClose}>Cancelar</button>
      <button type="button" className="ped-btn ped-btn-primario" disabled={!producto || !(precio > 0)} onClick={() => producto && onAplicar({ op: 'cambiar_producto_saldo', item_id: item.id, producto_id: producto.id, presentacion_id: producto.presentacionId, precio_unitario: precio, nombre: producto.nombre })}>Aplicar a la edición</button>
    </footer>
  </Modal>
}
