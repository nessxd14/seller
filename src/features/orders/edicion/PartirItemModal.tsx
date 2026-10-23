import { useMemo, useState } from 'react'
import { Check, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Modal } from '../../../components/Modal'
import { NumberField } from '../../../components/NumberField'
import { redondear2, type ItemBorrador } from '../../../domain/orders/edicionPedido'
import type { CambioPedido, PedidoLineaSurtido } from '../../../domain/orders/pedidoEdicion.types'
import { listPresentations } from '../../../infrastructure/services'
import { precioSugerido } from '../../../domain/pricing/precioPresentacion'
import type { Product, SalesChannel } from '../../../types'
import { ChipsLinea } from '../detalle/ItemsPedido'
import { bs, cant } from '../detalle/formato'
import { BuscadorProducto } from './BuscadorProducto'
import { priceForOrderChannel } from './canal'

interface Parte {
  clave: string
  producto_id: number | null
  presentacion_id: number | null
  nombre: string
  cantidad: number
  precio: number
  lineaIds: number[]
}

export interface PrefillPartir { lineaId: number | null }

const nuevaClave = (): string => crypto.randomUUID()

/** Partes iniciales: con "Ponerle precio propio" el sustituto ya viene como parte 2 (precio vacío). */
const partesIniciales = (item: ItemBorrador, prefill: PrefillPartir | undefined): Parte[] => {
  const sustituta = prefill?.lineaId != null ? item.lineas.find((linea) => linea.id === prefill.lineaId) : undefined
  if (sustituta) {
    return [
      { clave: nuevaClave(), producto_id: item.producto_id, presentacion_id: item.presentacion_id, nombre: item.descripcion, cantidad: item.cantidad_presentacion - sustituta.cantidad_presentacion, precio: item.precio_unitario, lineaIds: item.lineas.filter((l) => l.id !== sustituta.id).map((l) => l.id) },
      { clave: nuevaClave(), producto_id: sustituta.producto_id ?? null, presentacion_id: sustituta.presentacion_id ?? null, nombre: sustituta.descripcion, cantidad: sustituta.cantidad_presentacion, precio: 0, lineaIds: [sustituta.id] },
    ]
  }
  const primera = item.cantidad_despachada > 0 ? item.cantidad_despachada : Math.max(1, Math.floor(item.cantidad_presentacion / 2))
  return [
    { clave: nuevaClave(), producto_id: item.producto_id, presentacion_id: item.presentacion_id, nombre: item.descripcion, cantidad: primera, precio: item.precio_unitario, lineaIds: item.lineas.map((l) => l.id) },
    { clave: nuevaClave(), producto_id: null, presentacion_id: null, nombre: '', cantidad: Math.max(0, item.cantidad_presentacion - primera), precio: 0, lineaIds: [] },
  ]
}

function ChipsDeLineas({ lineas }: { lineas: PedidoLineaSurtido[] }) {
  if (!lineas.length) return <small className="ped-nota">Sin líneas de surtido todavía.</small>
  return <ul className="ped-parte-lineas">{lineas.map((linea) => <li key={linea.id}><span>{cant(linea.cantidad_presentacion)} · {linea.descripcion}</span><ChipsLinea linea={linea} /></li>)}</ul>
}

/**
 * Parte un ítem en varios, cada uno con su propio producto, cantidad y precio. La primera
 * parte conserva lo ya despachado; el surtido de Almacén no se mueve. "Aplicar" solo agrega
 * un cambio a la edición — nada se guarda en el servidor.
 */
export function PartirItemModal({ item, canal, prefill, onAplicar, onClose }: {
  item: ItemBorrador
  canal: SalesChannel
  prefill?: PrefillPartir
  onAplicar: (cambio: CambioPedido) => void
  onClose: () => void
}) {
  const [partes, setPartes] = useState<Parte[]>(() => partesIniciales(item, prefill))

  const total = redondear2(partes.reduce((suma, parte) => suma + parte.cantidad, 0))
  const cuadra = Math.abs(total - item.cantidad_presentacion) < 1e-9
  const minimoPrimera = item.cantidad_despachada
  const importeAntes = item.subtotal
  const importeDespues = useMemo(() => redondear2(partes.reduce((suma, parte, i) => {
    return suma + parte.cantidad * parte.precio * (i === 0 ? 1 - item.descuento_pct / 100 : 1)
  }, 0)), [partes, item.descuento_pct])

  const actualizar = (clave: string, cambios: Partial<Parte>) => setPartes((actuales) => actuales.map((parte) => (parte.clave === clave ? { ...parte, ...cambios } : parte)))
  const elegirProducto = async (clave: string, producto: Product) => {
    const presentaciones = await listPresentations(producto.id)
    const presentacion = presentaciones.find((p) => p.esBase) ?? presentaciones[0]
    const sugerido = precioSugerido(presentacion, canal, priceForOrderChannel(producto, canal))
    actualizar(clave, { producto_id: producto.id, presentacion_id: presentacion?.id || null, nombre: producto.nombre, precio: sugerido ?? priceForOrderChannel(producto, canal) })
  }

  const errores: string[] = []
  if (!cuadra) errores.push('Las partes no suman la cantidad del ítem.')
  if (partes[0].cantidad < minimoPrimera) errores.push(`La primera parte conserva lo despachado (mínimo ${cant(minimoPrimera)}).`)
  if (partes.some((parte) => parte.cantidad <= 0)) errores.push('Cada parte necesita una cantidad mayor a cero.')
  if (partes.slice(1).some((parte) => !parte.nombre)) errores.push('Elige el producto de cada parte nueva.')
  if (partes.slice(1).some((parte) => !(parte.precio > 0))) errores.push('Ponle precio a cada parte nueva.')

  const aplicar = () => onAplicar({
    op: 'partir',
    item_id: item.id,
    partes: partes.map((parte) => ({ producto_id: parte.producto_id, presentacion_id: parte.presentacion_id, cantidad_presentacion: parte.cantidad, precio_unitario: parte.precio, linea_ids: parte.lineaIds, nombre: parte.nombre })),
  })

  const lineasDe = (parte: Parte) => item.lineas.filter((linea) => parte.lineaIds.includes(linea.id))

  return <Modal title="Partir ítem" subtitle={item.descripcion} onClose={onClose} wide className="commercial-modal ped-partir">
    <div className="modal-body">
      <p className="ped-intro">Cada parte queda como un ítem con su propio precio. Las {cant(item.cantidad_despachada)} u ya despachadas se quedan en la primera parte; el surtido de almacén no se mueve.</p>
      <ol className="ped-partes">
        {partes.map((parte, i) => {
          const subtotal = redondear2(parte.cantidad * parte.precio)
          return <li key={parte.clave} className="ped-parte">
            <div className="ped-parte-cab"><strong>Parte {i + 1}</strong>{i >= 2 && <button type="button" className="ped-btn ped-btn-icono" aria-label={`Quitar parte ${i + 1}`} onClick={() => setPartes((actuales) => actuales.filter((p) => p.clave !== parte.clave))}><Trash2 aria-hidden /></button>}</div>
            <div className="ped-parte-campos">
              <div className="ped-campo ped-campo-producto">
                <span className="ped-campo-etiqueta">Producto</span>
                {i === 0
                  ? <p className="ped-solo-lectura">{parte.nombre}</p>
                  : <>
                    {parte.nombre && <p className="ped-solo-lectura">{parte.nombre}</p>}
                    <BuscadorProducto canal={canal} etiqueta={parte.nombre ? 'Cambiar producto' : 'Buscar producto'} onElegir={(producto) => void elegirProducto(parte.clave, producto)} />
                  </>}
              </div>
              <label className="ped-campo"><span className="ped-campo-etiqueta">Cantidad{i === 0 ? ` (mín. ${cant(minimoPrimera)})` : ''}</span>
                <NumberField ariaLabel={`Cantidad de la parte ${i + 1}`} min={i === 0 ? minimoPrimera : 0} step="any" value={parte.cantidad} onCommit={(cantidad) => actualizar(parte.clave, { cantidad })} />
              </label>
              <div className="ped-campo"><label><span className="ped-campo-etiqueta">Precio (Bs)</span>
                <NumberField ariaLabel={`Precio de la parte ${i + 1}`} min={0} step={0.01} autoFocus={i === 1 && prefill?.lineaId != null} value={parte.precio} placeholder="0,00" onCommit={(precio) => actualizar(parte.clave, { precio })} />
              </label></div>
              <p className="ped-parte-subtotal"><span>Subtotal</span><strong>{bs(subtotal)}</strong></p>
            </div>
            <ChipsDeLineas lineas={lineasDe(parte)} />
          </li>
        })}
      </ol>
      <button type="button" className="ped-btn ped-btn-punteado" onClick={() => setPartes((actuales) => [...actuales, { clave: nuevaClave(), producto_id: null, presentacion_id: null, nombre: '', cantidad: 0, precio: 0, lineaIds: [] }])}><Plus aria-hidden />Agregar parte</button>
      <div className="ped-fichas">
        <p className={`ped-ficha ${cuadra ? 'ped-ficha-ok' : 'ped-ficha-mal'}`}>{cuadra ? <Check aria-hidden /> : <TriangleAlert aria-hidden />}<span>Cantidad repartida</span><strong>{cant(total)} de {cant(item.cantidad_presentacion)}</strong></p>
        <p className="ped-ficha"><span>Importe del ítem</span><strong>{bs(importeAntes)} → {bs(importeDespues)}</strong></p>
      </div>
      {errores.length > 0 && <ul className="ped-errores" role="status">{errores.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
    <footer className="modal-actions ped-pie-modal">
      <small>Se suma a tu edición. Se guarda recién al confirmar.</small>
      <button type="button" className="ped-btn ped-btn-suave" onClick={onClose}>Cancelar</button>
      <button type="button" className="ped-btn ped-btn-primario" disabled={errores.length > 0} onClick={aplicar}>Aplicar a la edición</button>
    </footer>
  </Modal>
}
