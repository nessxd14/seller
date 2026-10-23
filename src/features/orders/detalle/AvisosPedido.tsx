import { ArrowLeftRight, Ban, Check, ShoppingCart, Tag } from 'lucide-react'
import type { AccionAviso, PedidoAviso, PedidoItem } from '../../../domain/orders/pedidoEdicion.types'
import type { IntentoEdicion } from '../edicion/intento'
import { Chip } from './Chip'
import { bs, cant, fechaHora } from './formato'

/**
 * Un aviso de Almacén abierto por tarjeta. Las acciones que no tocan dinero se resuelven en el
 * servidor (resolver_aviso_pedido); las que sí lo tocan abren la sesión de edición encaminada.
 */
export function AvisosPedido({ avisos, items, ocupado, puedeEditar, onResolver, onEditar }: {
  avisos: PedidoAviso[]
  items: PedidoItem[]
  ocupado: boolean
  puedeEditar: boolean
  onResolver: (aviso: PedidoAviso, accion: AccionAviso) => void
  onEditar: (intento: IntentoEdicion) => void
}) {
  if (!avisos.length) return null
  return <section className="ped-avisos" aria-label="Avisos de almacén">
    {avisos.map((aviso) => {
      const item = items.find((candidato) => candidato.id === aviso.item_id)
      const linea = item?.lineas.find((candidata) => candidata.id === aviso.linea_id)
      const nombre = item?.descripcion ?? 'el ítem'
      const sustitucion = aviso.tipo === 'SUSTITUCION'
      return <article key={aviso.id} className={`ped-aviso ${sustitucion ? 'ped-aviso-violeta' : 'ped-aviso-rojo'}`}>
        <div className="ped-aviso-cab">
          <Chip tone={sustitucion ? 'violet' : 'red'}>{sustitucion ? 'Sustitución' : 'Sin cubrir'}</Chip>
          <small>{aviso.creado_por} · {fechaHora(aviso.creado_en)}</small>
        </div>
        {sustitucion
          ? <p>Almacén cubrió {cant(linea?.cantidad_presentacion ?? 0)} de <strong>{nombre}</strong> con <strong>{linea?.descripcion ?? 'otro producto'}</strong>. Se cobra al precio del ítem ({bs(item?.precio_unitario ?? 0)}) hasta que decidas.</p>
          : <p>Almacén no tiene {cant(item?.cantidad_sin_cubrir ?? linea?.cantidad_presentacion ?? 0)} de <strong>{nombre}</strong>. Esas {cant(item?.cantidad_sin_cubrir ?? linea?.cantidad_presentacion ?? 0)} ya no se cobran (− {bs(aviso.monto)}).</p>}
        {aviso.motivo && <small className="ped-aviso-motivo">Motivo: {aviso.motivo}</small>}
        <div className="ped-aviso-acciones">
          {sustitucion ? <>
            <button type="button" className="ped-btn ped-btn-suave" disabled={ocupado || !puedeEditar} onClick={() => onResolver(aviso, 'MANTENER_PRECIO')}><Check aria-hidden />Mantener precio</button>
            <button type="button" className="ped-btn ped-btn-suave" disabled={ocupado || !puedeEditar} onClick={() => onEditar({ tipo: 'precio_propio', itemId: aviso.item_id, lineaId: aviso.linea_id })}><Tag aria-hidden />Ponerle precio propio</button>
            <button type="button" className="ped-btn ped-btn-suave" disabled={ocupado || !puedeEditar} onClick={() => onResolver(aviso, 'RECHAZAR_SUSTITUTO')}><Ban aria-hidden />Rechazar sustituto</button>
          </> : <>
            <button type="button" className="ped-btn ped-btn-suave" disabled={ocupado || !puedeEditar} onClick={() => onResolver(aviso, 'ACEPTAR')}><Check aria-hidden />Aceptar</button>
            <button type="button" className="ped-btn ped-btn-suave" disabled={ocupado || !puedeEditar} onClick={() => onEditar({ tipo: 'a_compra', itemId: aviso.item_id })}><ShoppingCart aria-hidden />Mandar a compra</button>
            <button type="button" className="ped-btn ped-btn-suave" disabled={ocupado || !puedeEditar} onClick={() => onEditar({ tipo: 'reemplazar', itemId: aviso.item_id })}><ArrowLeftRight aria-hidden />Reemplazar con otro producto</button>
          </>}
        </div>
      </article>
    })}
  </section>
}
