import type { PedidoItem, PedidoLineaSurtido } from '../../../domain/orders/pedidoEdicion.types'
import { Chip } from './Chip'
import { bs, cant } from './formato'

export function ChipsLinea({ linea }: { linea: PedidoLineaSurtido }) {
  return <>
    {linea.estado === 'DESPACHADA' && <Chip tone="green">Despachada</Chip>}
    {linea.estado === 'POR_DESPACHAR' && <Chip tone="gray">Por despachar</Chip>}
    {linea.estado === 'POR_COMPRAR' && <Chip tone="blue">Por comprar</Chip>}
    {linea.estado === 'SIN_CUBRIR' && <Chip tone="red">Sin cubrir</Chip>}
    {linea.tipo_surtido === 'SUSTITUTO' && <Chip tone="violet">Sustituto</Chip>}
    {linea.tipo_surtido === 'PARTIDA' && <Chip tone="orange">Partida</Chip>}
  </>
}

export const ubicacionLinea = (linea: PedidoLineaSurtido): string =>
  [linea.ubicacion, linea.tanda != null ? `tanda ${linea.tanda}` : null].filter(Boolean).join(' · ')

/** Ítems comerciales (lo que se cobra) con sus líneas de surtido (lo que sale de almacén) debajo. */
export function ItemsPedido({ items }: { items: PedidoItem[] }) {
  return <div className="ped-tabla-caja">
    <table className="ped-tabla">
      <thead><tr><th scope="col">Ítem</th><th scope="col" className="ped-num">Cantidad</th><th scope="col" className="ped-num">Precio</th><th scope="col" className="ped-num">Subtotal</th></tr></thead>
      {items.map((item) => {
        const quitado = item.estado === 'QUITADO'
        const sinCubrir = item.cantidad_sin_cubrir > 0
        const completo = item.cantidad_presentacion * item.precio_unitario * (1 - item.descuento_pct / 100)
        return <tbody key={item.id} className={quitado ? 'ped-item-quitado' : undefined}>
          <tr>
            <th scope="row" className="ped-item-nombre"><strong>{item.descripcion}</strong>{item.presentacion_nombre && <small>{item.presentacion_nombre}</small>}{quitado && <Chip tone="gray">Quitado</Chip>}</th>
            <td className="ped-num">{cant(item.cantidad_presentacion)}{sinCubrir && <small className="ped-rojo">{cant(item.cantidad_presentacion - item.cantidad_sin_cubrir)} se cobran</small>}</td>
            <td className="ped-num">{bs(item.precio_unitario)}{item.descuento_pct > 0 && <small>−{cant(item.descuento_pct)}%</small>}</td>
            <td className="ped-num"><strong>{bs(item.subtotal)}</strong>{sinCubrir && <small className="ped-tachado">{bs(completo)}</small>}</td>
          </tr>
          {!quitado && item.lineas.length > 0 && <tr className="ped-fila-lineas"><td colSpan={4}>
            <ul className="ped-lineas">
              {item.lineas.map((linea) => <li key={linea.id}>
                <span className="ped-linea-desc">{linea.descripcion}</span>
                <span className="ped-linea-cant">{cant(linea.cantidad_presentacion)}</span>
                <span className="ped-linea-chips"><ChipsLinea linea={linea} /></span>
                <small>{ubicacionLinea(linea)}</small>
              </li>)}
            </ul>
          </td></tr>}
        </tbody>
      })}
    </table>
  </div>
}
