// Pure median / rolling-median helpers for the price-history chart (Precios tab).
// No DOM/chart dependency so these stay trivially unit-testable.

export const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface SeriesPoint { x: number; y: number }

/**
 * Trailing moving median over the last `windowSize` points (by x order, not calendar
 * days — irregular spacing between orders is expected). Points are sorted by x first
 * so callers can pass them in any order.
 */
export const rollingMedian = (points: SeriesPoint[], windowSize = 7): SeriesPoint[] => {
  if (windowSize < 1) throw new Error('windowSize debe ser >= 1')
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const result: SeriesPoint[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = Math.max(0, i - windowSize + 1)
    const windowMedian = median(sorted.slice(start, i + 1).map((p) => p.y))
    if (windowMedian !== null) result.push({ x: sorted[i].x, y: windowMedian })
  }
  return result
}
