// Categorías que puede traer historial_precios/resumen_precios_producto (ver
// 2026-09-28_historial_precios.sql): MAYOR/TIENDA/INSTITUCIONAL/MUNICIPAL/CORPORATIVO
// para pedidos y cotizaciones, MOSTRADOR/VTD para ventas. Distinto del
// CategoriaPedido de segmentoPedido.ts (ese no tiene MUNICIPAL/MOSTRADOR/VTD — son
// datos históricos/de venta que ese tipo nunca necesitó modelar).
export type PrecioCategoria = 'MAYOR' | 'TIENDA' | 'INSTITUCIONAL' | 'MUNICIPAL' | 'CORPORATIVO' | 'MOSTRADOR' | 'VTD'

export type PrecioFuente = 'PEDIDO' | 'COTIZACION' | 'VENTA'

// Un color por categoría, consistente en todo el gráfico (leyenda, puntos, markLines).
const CATEGORIA_COLORS: Record<PrecioCategoria, string> = {
  MAYOR: '#2563eb',
  INSTITUCIONAL: '#7c3aed',
  CORPORATIVO: '#059669',
  MUNICIPAL: '#d97706',
  TIENDA: '#db2777',
  MOSTRADOR: '#db2777',
  VTD: '#0891b2',
}

export const categoriaColor = (categoria: string): string => CATEGORIA_COLORS[categoria as PrecioCategoria] ?? '#64748b'

const CATEGORIA_LABELS: Record<PrecioCategoria, string> = {
  MAYOR: 'Mayoreo',
  INSTITUCIONAL: 'Institucional',
  CORPORATIVO: 'Corporativo',
  MUNICIPAL: 'Municipal',
  TIENDA: 'Tienda',
  MOSTRADOR: 'Mostrador',
  VTD: 'VTD',
}

export const categoriaLabel = (categoria: string): string => CATEGORIA_LABELS[categoria as PrecioCategoria] ?? categoria

export type ListaPrecioKey = 'retail' | 'mayoreo' | 'institucional' | 'corporativo' | 'municipal'

/**
 * Qué precio de lista (producto.precio_*) corresponde a cada categoría del historial —
 * usado tanto para el chip de delta en el header como para los markLine de lista en el
 * gráfico. MOSTRADOR/VTD/TIENDA comparan todas contra la lista retail: son ventas de
 * mostrador, no tienen lista propia.
 */
export const categoriaToListaKey = (categoria: string): ListaPrecioKey | null => {
  switch (categoria as PrecioCategoria) {
    case 'MAYOR': return 'mayoreo'
    case 'INSTITUCIONAL': return 'institucional'
    case 'CORPORATIVO': return 'corporativo'
    case 'MUNICIPAL': return 'municipal'
    case 'TIENDA': case 'MOSTRADOR': case 'VTD': return 'retail'
    default: return null
  }
}

export const listaPrecioLabel = (key: ListaPrecioKey): string => ({
  retail: 'Lista retail',
  mayoreo: 'Lista mayoreo',
  institucional: 'Lista institucional',
  corporativo: 'Lista corporativo',
  municipal: 'Lista municipal',
}[key])
