// Generador de Code128 (subset B) en SVG puro, sin dependencias — brief VTD 2.3 pide un
// código de barras en el ticket y no hay ninguna librería de barcode instalada en el
// proyecto (ver reporte de exploración). Subset B cubre ASCII 32-127, que alcanza para
// "VTD-2026-00001".
const START_B = 104
const STOP = 106

// Ancho de cada símbolo en "módulos", tabla estándar Code128 (dominio público). Índice =
// valor del símbolo (0-102 caracteres, 103/104/105 START A/B/C, 106 STOP).
const PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const encode128B = (text: string): number[] => {
  const values = [START_B, ...Array.from(text).map((c) => c.charCodeAt(0) - 32)]
  let checksum = values[0]
  for (let i = 1; i < values.length; i++) checksum += values[i] * i
  return [...values, checksum % 103, STOP]
}

export function Barcode128({ value, height = 40 }: { value: string; height?: number }) {
  const safe = Array.from(value).every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 127) ? value : ''
  if (!safe) return null
  const widths = encode128B(safe).flatMap((code) => PATTERNS[code].split('').map(Number))
  let x = 0
  const bars: Array<{ x: number; w: number }> = []
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w }) // posiciones pares = barra; impares = espacio
    x += w
  })
  const totalWidth = x
  return (
    <svg className="vtd-barcode" viewBox={`0 0 ${totalWidth} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={`Código de barras ${safe}`}>
      <rect x={0} y={0} width={totalWidth} height={height} fill="#fff" />
      {bars.map((bar, i) => <rect key={i} x={bar.x} y={0} width={bar.w} height={height} fill="#000" />)}
    </svg>
  )
}
