export type SalesChannel = 'retail' | 'mayoreo' | 'institucional'

export interface Product {
  id: number
  sku: string
  codigoBarra: string
  codigoFabrica: string
  nombre: string
  descripcion: string
  categoria: string
  imagen: string
  color: string
  precioRetail: number
  precioMayoreo: number
  precioInstitucional: number
  stockTienda: number
  stockAlmacen: number
}

export interface CartItem extends Product {
  cantidad: number
  precioAplicado: number
  descuento: number
  ubicacion: string
  observacion: string
  motivoPrecio: string
}
