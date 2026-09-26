// Brief hotkeys — Tarea 3a: "N*código" en el buscador agrega N unidades de una sola
// pasada (multiplicador + escaneo). Separado de PosPage.tsx para poder testearlo sin
// DOM: cualquier texto con un '*' se interpreta como intento de multiplicador — si el
// prefijo no es un entero >= 1 o no queda código después del '*', el intento es
// inválido (null). Sin '*' no hay multiplicador: se agrega 1 unidad del texto tal cual.
export function parseQuantityScan(raw: string): { quantity: number; code: string } | null {
  const starIndex = raw.indexOf('*')
  if (starIndex < 0) return { quantity: 1, code: raw }
  const quantityPart = raw.slice(0, starIndex)
  const codePart = raw.slice(starIndex + 1)
  if (!/^\d{1,4}$/.test(quantityPart) || codePart.length === 0) return null
  const quantity = Number(quantityPart)
  if (quantity < 1) return null
  return { quantity, code: codePart }
}
