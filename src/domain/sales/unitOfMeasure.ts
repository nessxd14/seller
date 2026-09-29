// Unidad de medida de los ítems personalizados. Refleja la normalización de la base
// (upper(btrim(...)), 'UNIDAD' por defecto, máx. 30 caracteres): lo que ve el usuario es
// lo que se guarda.
export const UNIDADES_SUGERIDAS = ['UNIDAD', 'PIEZA', 'PAR', 'JUEGO', 'CAJA', 'PAQUETE', 'BOLSA', 'RESMA', 'PLIEGO', 'ROLLO', 'METRO', 'LITRO', 'KILO', 'SERVICIO']

export const UNIT_MAX_LENGTH = 30

export const normalizeUnit = (raw: string | undefined): string => {
  const cleaned = (raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, UNIT_MAX_LENGTH).trim()
  return cleaned || 'UNIDAD'
}

// Líneas históricas tienen unidad null: se muestra solo la cantidad, sin inventar "UNIDAD".
export const formatQtyWithUnit = (qty: number, unit?: string | null): string => {
  const trimmed = unit?.trim()
  return trimmed ? `${qty} ${trimmed}` : String(qty)
}
