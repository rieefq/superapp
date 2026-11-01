/**
 * Charts (track A2): inline SVG, responsive, token-colored, accessible (table twin,
 * keyboard inspection, legends). Series hues follow the validated SERIES_HUES order.
 */
export { Sparkline } from './Sparkline'
export type { SparklineProps } from './Sparkline'
export { TimeSeriesChart } from './TimeSeriesChart'
export type { TimeSeriesChartProps, TimeSeries, TimePoint } from './TimeSeriesChart'
export { BarChart } from './BarChart'
export type { BarChartProps, BarSeries } from './BarChart'
export { DonutChart } from './DonutChart'
export type { DonutChartProps, DonutSlice } from './DonutChart'
export { Heatmap } from './Heatmap'
export type { HeatmapProps, WeekdayHourCell, CalendarCell } from './Heatmap'
export { ChartFrame, ChartLegend, ChartTable, ChartTooltip, LegendSwatch } from './frame'
export type { ChartFrameProps, ChartLegendProps, ChartTableProps, ChartTableColumn, LegendItem, TooltipRow, ChartSurface } from './frame'
export { niceTicks, timeTicks, linearScale, axisNumberFormatter, niceNumber } from './scale'
export type { NiceTicks, TimeTicks, TimeUnit, LinearScale } from './scale'
export { SERIES_HUES, MAX_SERIES, seriesColor, hueColor, resolveSeriesColor, rampColor, foldIntoOther, OTHER_COLOR } from './palette'
export type { SeriesColorSpec } from './palette'
