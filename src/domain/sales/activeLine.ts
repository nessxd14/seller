// Línea objetivo de los atajos de carrito: la seleccionada si sigue en el carrito; si no,
// opcionalmente la última. Las acciones destructivas usan fallbackToLast: false.
export const resolveActiveLineId = (
  cartIds: number[],
  selectedLineId: number | null,
  opts: { fallbackToLast: boolean },
): number | null => {
  if (selectedLineId != null && cartIds.includes(selectedLineId)) return selectedLineId
  if (opts.fallbackToLast && cartIds.length > 0) return cartIds[cartIds.length - 1]
  return null
}
