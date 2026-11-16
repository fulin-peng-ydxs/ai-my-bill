import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent } from 'echarts/components'
import { init, use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

// 仅在图表容器挂载后加载；报表路由、金额和下钻入口不等待图表依赖。
use([BarChart, LineChart, GridComponent, LegendComponent, SVGRenderer])
export { init }
