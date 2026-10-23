import { lineaViva } from '../../../domain/orders/edicionPedido'
import type { PedidoItem, PedidoLineaSurtido } from '../../../domain/orders/pedidoEdicion.types'
import { Chip } from './Chip'
import { bs, cant } from './formato'

const humanizar = (estado: string): string => {
  const texto = estado.toLowerCase().replace(/_/g, ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export function ChipsLinea({ linea }: { linea: PedidoLineaSurtido }) {
  const conocido = ['DESPACHADA', 'POR_DESPACHAR', 'POR_COMPRAR', 'SIN_CUBRIR', 'COMPRADO_DIRECTO'].includes(linea.estado)
  return <>
    {linea.estado === 'DESPACHADA' && <Chip tone="green">Despachada</Chip>}
    {linea.estado === 'POR_DESPACHAR' && <Chip tone="gray">Por despachar</Chip>}
    {linea.estado === 'POR_COMPRAR' && <Chip tone="blue">Por comprar</Chip>}
    {linea.estado === 'SIN_CUBRIR' && <Chip tone="red">Sin cubrir</Chip>}
    {linea.estado === 'COMPRADO_DIRECTO' && <Chip tone="green">Comprado directo</Chip>}
    {!conocido && <Chip tone="gray">{humanizar(linea.estado)}</Chip>}
    {linea.tipo_surtido === 'SUSTITUTO' && <Chip tone="violet">Sustituto</Chip>}
    {linea.tipo_surtido === 'PARTIDA' && <Chip tone="orange">Partida</Chip>}
  </>
}

export const ubicacionLinea = (linea: PedidoLineaSurtido): string => linea.ubicacion ?? ''

const minusculas = (texto: string | null | undefined): string | null => (texto ? texto.toLowerCase() : null)

/** Ítems comerciales (lo que se cobra) con sus líneas de surtido (lo que sale de almacén) debajo. */
export function ItemsPedido({ items }: { items: PedidoItem[] }) {
  return <div className="ped-tabla-caja">
    <table className="ped-tabla">
      <colgroup><col /><col className="ped-col-cant" /><col className="ped-col-precio" /><col className="ped-col-sub" /></colgroup>
      <thead><tr><th scope="col">Ítem</th><th scope="col" className="ped-num">Cantidad</th><th scope="col" className="ped-num">Precio</th><th scope="col" className="ped-num">Subtotal</th></tr></thead>
      {items.map((item) => {
        const quitado = item.estado === 'QUITADO'
        const sinCubrir = item.cantidad_sin_cubrir > 0
        const meta = [item.sku, item.presentacion_nombre].filter(Boolean).join(' · ')
        const unidad = minusculas(item.presentacion_nombre ?? item.unidad_medida)
        const vivas = item.lineas.filter(lineaViva)
        const reemplazadas = item.lineas.length - vivas.length
        return <tbody key={item.id} className={quitado ? 'ped-item-quitado' : undefined}>
          <tr className="ped-fila-item">
            <th scope="row" className="ped-item-nombre">
              <strong>{item.descripcion}</strong>
              {meta && <span className="ped-item-meta">{meta}</span>}
              {sinCubrir && <span className="ped-sin-cubrir">{cant(item.cantidad_sin_cubrir)} sin cubrir · se sigue cobrando</span>}
              {quitado && <Chip tone="gray">Quitado</Chip>}
            </th>
            <td className="ped-num">{cant(item.cantidad_presentacion)}{unidad && <span className="ped-unidad">{unidad}</span>}</td>
            <td className="ped-num">{bs(item.precio_unitario)}{item.descuento_pct > 0 && <small>−{cant(item.descuento_pct)}%</small>}</td>
            <td className="ped-num"><strong>{bs(item.subtotal)}</strong></td>
          </tr>
          {!quitado && (vivas.length > 0 || reemplazadas > 0) && <tr className="ped-fila-lineas"><td colSpan={4}>
            <ul className="ped-lineas">
              {vivas.map((linea) => {
                const otro = linea.tipo_surtido === 'SUSTITUTO' || (linea.producto_id != null && item.producto_id != null && linea.producto_id !== item.producto_id)
                const unidadLinea = minusculas(linea.presentacion_nombre)
                return <li key={linea.id}>
                  <span className="ped-linea-cant">{cant(linea.cantidad_presentacion)}{unidadLinea && <> <span className="ped-linea-unidad">{unidadLinea}</span></>}</span>
                  <span className="ped-linea-chips"><ChipsLinea linea={linea} /></span>
                  {linea.ubicacion && <span className="ped-linea-ubic">{linea.ubicacion}</span>}
                  {otro && <span className="ped-linea-otro">{linea.descripcion}</span>}
                </li>
              })}
              {reemplazadas > 0 && <li className="ped-lineas-historial">{reemplazadas} {reemplazadas === 1 ? 'línea reemplazada' : 'líneas reemplazadas'} por almacén</li>}
            </ul>
          </td></tr>}
        </tbody>
      })}
    </table>
  </div>
}
