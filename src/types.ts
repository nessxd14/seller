export type SalesChannel = 'retail' | 'mayoreo' | 'institucional' | 'municipal'

export interface Product {
  id: number
  sku: string
  codigoBarra: string
  codigoFabrica: string
  nombre: string
  descripcion: string
  categoria: string
  imagen: string
  imagenUrl?: string
  color: string
  precioRetail: number
  precioMayoreo: number
  precioInstitucional: number
  precioMunicipal: number
  stockTienda: number
  stockAlmacen: number
  // Which non-retail channel prices were NOT set explicitly and fell back to precioRetail
  // (Supabase adapter only — see ProductRepository.supabase.ts's precioCanal helper). Absent/
  // undefined in mock mode, where every channel price is seeded, so there is no gap to mark.
  preciosHeredados?: { mayoreo: boolean; institucional: boolean; municipal: boolean }
  // Brief S2 — agrupar resultados de búsqueda por familia (producto.familia_id, ~32% de
  // cobertura). Ausente/undefined en modo mock y en productos sin familia asignada: esos
  // van al grupo "Otros" en vez de forzar un valor que la base no tiene.
  familiaId?: number
  familiaNombre?: string
}

export interface CartItem extends Product {
  cantidad: number
  precioAplicado: number
  descuento: number
  // Origin sucursal this line will be picked from at checkout — retail's channel default
  // is Tienda (see PosContext.addProduct); mirrors DraftOrderEditor's sourceLocation vocabulary.
  ubicacion: 'Tienda' | 'Almacén'
  observacion: string
  motivoPrecio: string
  // Active sales-unit presentation for this line (e.g. "Caja" with factor 24). Absent (or
  // factorUnidadBase === 1) means the line is in the product's base unit — mirrors
  // WorkflowLine's vocabulary in src/application/shared/models.ts exactly.
  presentacionId?: number
  presentacionNombre?: string
  factorUnidadBase?: number
  // TAREA 1 (Tanda 4): true once the seller has manually picked an origin via OriginPin —
  // freezes `ubicacion` against the automatic channel/cliente-acreedor recompute in
  // PosContext (setChannel/selectCustomer) until the line is removed. Without this,
  // picking the customer at the end of the sale would silently revert origins the
  // cajero had already adjusted by hand.
  origenManual?: boolean
  // TAREA B: true once the seller has manually committed a price for this line (via the
  // inline editor or EditCartItemModal) — freezes precioAplicado/descuento against the
  // automatic channel-switch recompute in PosContext's setChannel until cleared. Cleared
  // again on a presentation change, since that recompute is itself a fresh, deliberate
  // baseline the seller just triggered.
  precioModificado?: boolean
  // Brief S11 Bloque C: ítem sin producto de catálogo — se agrega directo con
  // descripción/cantidad/precio desde CartPanel (ver PosContext.addCustomItem). No tiene
  // SKU/stock real (los campos de Product, incluida descripcion, quedan en placeholders
  // vacíos/cero); no se puede vender por registrar_venta (no tiene producto_id), solo cotizar.
  isCustomItem?: boolean
}
