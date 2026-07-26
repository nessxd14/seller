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
}
