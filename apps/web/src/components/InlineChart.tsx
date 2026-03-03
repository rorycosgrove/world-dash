'use client';

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ChartSpec } from '@/lib/api';

const CHART_COLORS = [
  '#8b5cf6', // purple
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs shadow-lg">
      <p className="text-gray-300 font-medium mb-0.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="text-[11px]">
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  );
}

interface InlineChartProps {
  spec: ChartSpec;
  /** Height in px.  Defaults to 200 for chat panel, pass larger for dashboard view. */
  height?: number;
  /** If true, render at expanded dashboard size with legends. */
  expanded?: boolean;
}

export default function InlineChart({ spec, height = 200, expanded = false }: InlineChartProps) {
  if (!spec || !spec.series?.length) {
    return (
      <div className="flex items-center justify-center h-20 text-xs text-gray-500">
        No chart data
      </div>
    );
  }

  const firstSeries = spec.series[0];
  const data = firstSeries.data.map((d) => ({
    name: d.x,
    value: d.y,
    label: d.label || d.x,
  }));

  // Multi-series: merge all series into a flat data array keyed by x
  const multiData = (() => {
    if (spec.series.length <= 1) return data;
    const xMap: Record<string, Record<string, any>> = {};
    for (const series of spec.series) {
      for (const pt of series.data) {
        if (!xMap[pt.x]) xMap[pt.x] = { name: pt.x };
        xMap[pt.x][series.name] = pt.y;
      }
    }
    return Object.values(xMap);
  })();

  const xLabel = spec.x_axis?.label || '';
  const yLabel = spec.y_axis?.label || '';
  const showLegend = expanded || spec.series.length > 1;

  const commonCartesian = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
      <XAxis
        dataKey="name"
        tick={{ fontSize: 10, fill: '#9ca3af' }}
        axisLine={{ stroke: '#4b5563' }}
        tickLine={{ stroke: '#4b5563' }}
        label={xLabel ? { value: xLabel, position: 'bottom', fontSize: 10, fill: '#9ca3af', offset: -5 } : undefined}
        interval={0}
        angle={data.length > 6 ? -30 : 0}
        textAnchor={data.length > 6 ? 'end' : 'middle'}
        height={data.length > 6 ? 50 : 30}
      />
      <YAxis
        tick={{ fontSize: 10, fill: '#9ca3af' }}
        axisLine={{ stroke: '#4b5563' }}
        tickLine={{ stroke: '#4b5563' }}
        label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: 10, fill: '#9ca3af' } : undefined}
        width={35}
      />
      <Tooltip content={<CustomTooltip />} />
      {showLegend && <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />}
    </>
  );

  const renderChart = () => {
    switch (spec.chart_type) {
      case 'bar':
        return (
          <BarChart data={multiData} margin={{ top: 5, right: 5, bottom: data.length > 6 ? 20 : 5, left: 0 }}>
            {commonCartesian}
            {spec.series.length <= 1 ? (
              <Bar dataKey="value" name={firstSeries.name || yLabel} radius={[3, 3, 0, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            ) : (
              spec.series.map((s, i) => (
                <Bar
                  key={s.name}
                  dataKey={s.name}
                  name={s.name}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  radius={[3, 3, 0, 0]}
                />
              ))
            )}
          </BarChart>
        );

      case 'line':
        return (
          <LineChart data={multiData} margin={{ top: 5, right: 5, bottom: data.length > 6 ? 20 : 5, left: 0 }}>
            {commonCartesian}
            {spec.series.length <= 1 ? (
              <Line
                type="monotone"
                dataKey="value"
                name={firstSeries.name || yLabel}
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                dot={{ r: 3, fill: CHART_COLORS[0] }}
                activeDot={{ r: 5 }}
              />
            ) : (
              spec.series.map((s, i) => (
                <Line
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  name={s.name}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CHART_COLORS[i % CHART_COLORS.length] }}
                />
              ))
            )}
          </LineChart>
        );

      case 'area':
        return (
          <AreaChart data={multiData} margin={{ top: 5, right: 5, bottom: data.length > 6 ? 20 : 5, left: 0 }}>
            {commonCartesian}
            {spec.series.length <= 1 ? (
              <Area
                type="monotone"
                dataKey="value"
                name={firstSeries.name || yLabel}
                stroke={CHART_COLORS[0]}
                fill={CHART_COLORS[0]}
                fillOpacity={0.3}
              />
            ) : (
              spec.series.map((s, i) => (
                <Area
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  name={s.name}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.2}
                />
              ))
            )}
          </AreaChart>
        );

      case 'pie':
        return (
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={expanded ? 40 : 25}
              outerRadius={expanded ? 80 : 55}
              paddingAngle={2}
              label={({ name, value }) => `${name}: ${value}`}
              labelLine={{ stroke: '#6b7280', strokeWidth: 1 }}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />}
          </PieChart>
        );

      case 'radar':
        return (
          <RadarChart cx="50%" cy="50%" outerRadius={expanded ? 80 : 55} data={data}>
            <PolarGrid stroke="#374151" />
            <PolarAngleAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} />
            <PolarRadiusAxis tick={{ fontSize: 9, fill: '#6b7280' }} />
            {spec.series.length <= 1 ? (
              <Radar
                name={firstSeries.name || 'Value'}
                dataKey="value"
                stroke={CHART_COLORS[0]}
                fill={CHART_COLORS[0]}
                fillOpacity={0.3}
              />
            ) : (
              spec.series.map((s, i) => (
                <Radar
                  key={s.name}
                  name={s.name}
                  dataKey={s.name}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.15}
                />
              ))
            )}
            <Tooltip content={<CustomTooltip />} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />}
          </RadarChart>
        );

      default:
        return (
          <BarChart data={data}>
            {commonCartesian}
            <Bar dataKey="value" name={firstSeries.name || yLabel} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
          </BarChart>
        );
    }
  };

  return (
    <div className="w-full">
      {spec.title && (
        <p className="text-[11px] font-medium text-gray-300 mb-1 text-center">{spec.title}</p>
      )}
      <ResponsiveContainer width="100%" height={height}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}
