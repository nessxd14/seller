import type { Product } from '../../types'
import { normalizarBusqueda } from '../customers/textSearch'

export const cleanProductQuery = (query: string) => query.replace(/[\u0000-\u001f\u007f]/g, '').trim() // eslint-disable-line no-control-regex

export const isExactProductCode = (product: Product, query: string) => {
  const code = cleanProductQuery(query).toLocaleLowerCase()
  return Boolean(code) && [product.sku, product.codigoBarra, product.codigoFabrica].some((value) => value && value.toLocaleLowerCase() === code)
}

export const matchesProductQuery = (product: Product, query: string) => {
  const terms = normalizarBusqueda(cleanProductQuery(query)).split(/\s+/).filter(Boolean)
  const text = normalizarBusqueda([product.nombre, product.sku, product.codigoBarra, product.codigoFabrica, product.descripcion].join(' '))
  return terms.every((term) => text.includes(term))
}
