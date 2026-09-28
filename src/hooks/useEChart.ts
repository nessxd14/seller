// Small modular-import wrapper around ECharts, scoped to exactly what the Precios tab
// chart needs (brief: scatter + line series, grid/tooltip/legend/dataZoom/markLine,
// canvas renderer) so the rest of the app's main bundle never pays for it — this hook
// itself is only ever imported from the React.lazy-loaded chart chunk.
import { useEffect, useRef, type RefObject } from 'react'
import * as echarts from 'echarts/core'
import { ScatterChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ComposeOption } from 'echarts/core'
import type { ScatterSeriesOption, LineSeriesOption } from 'echarts/charts'
import type { GridComponentOption, TooltipComponentOption, LegendComponentOption, DataZoomComponentOption, MarkLineComponentOption } from 'echarts/components'

echarts.use([ScatterChart, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer])

export type PriceChartOption = ComposeOption<
  ScatterSeriesOption | LineSeriesOption | GridComponentOption | TooltipComponentOption | LegendComponentOption | DataZoomComponentOption | MarkLineComponentOption
>

export function useEChart(
  ref: RefObject<HTMLDivElement | null>,
  option: PriceChartOption | null,
  onEvents?: { click?: (params: echarts.ECElementEvent) => void },
) {
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init/dispose once, ref identity is stable
  }, [])

  useEffect(() => {
    if (!chartRef.current || !option) return
    chartRef.current.setOption(option, true)
  }, [option])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onEvents?.click) return
    const handler = onEvents.click
    chart.on('click', handler)
    return () => { chart.off('click', handler) }
  }, [onEvents?.click])

  return chartRef
}
