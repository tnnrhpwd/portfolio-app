import React from 'react';
import { Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import { formatMoney, formatMoneyCompact } from './annuityEngine';
import useChartTheme, { withAlpha } from './useChartTheme';
import './AnnuityChart.css';

Chart.register(...registerables);

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A thin, theme-aware wrapper around Chart.js.
 *
 * It only ever plots what it is given — the old graph padded its data with
 * invented periods and repeated the final value into them, which drew a flat
 * tail that looked like real data.
 *
 * @param {object}   props
 * @param {string[]} props.labels        One x-axis label per data point.
 * @param {Array}    props.series        `{label, data, color, dashed, fill}`.
 *                                       `color` is a CSS custom property name.
 * @param {string}   props.title
 * @param {string}   props.description
 * @param {string}   props.emptyMessage  Shown when there is nothing to plot.
 * @param {function} props.yFormatter    Axis + tooltip money formatter.
 */
function AnnuityChart({
  labels = [],
  series = [],
  title = 'Value over time',
  description = '',
  emptyMessage = 'Enter a value to see the chart.',
  yFormatter = formatMoneyCompact,
  tooltipFormatter = formatMoney,
  footnote = '',
}) {
  const { resolve: resolveColor, ready, version } = useChartTheme();

  const plotted = series.filter(
    (entry) => Array.isArray(entry?.data) && entry.data.some((value) => Number.isFinite(value)),
  );
  const hasData = plotted.length > 0 && labels.length > 0;

  const gridColor = withAlpha(resolveColor('--border-nav'), 0.6);
  const accentText = resolveColor('--text-color-accent');
  const strongText = resolveColor('--text-color');

  const data = {
    labels,
    datasets: plotted.map((entry) => {
      const color = resolveColor(entry.color);
      return {
        label: entry.label,
        data: entry.data,
        borderColor: color,
        backgroundColor: entry.fill ? withAlpha(color, 0.16) : color,
        fill: entry.fill ? 'origin' : false,
        borderDash: entry.dashed ? [7, 5] : undefined,
        borderWidth: entry.width || 2,
        pointRadius: labels.length > 30 ? 0 : 2,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
        tension: 0.25,
        spanGaps: true,
      };
    }),
  };

  const animate = !prefersReducedMotion();

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: animate ? { duration: 700, easing: 'easeOutQuart' } : false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: plotted.length > 1,
        position: 'top',
        labels: {
          color: strongText,
          usePointStyle: true,
          boxWidth: 10,
          padding: 16,
          font: { size: 12 },
        },
      },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.92)',
        titleColor: '#fff',
        bodyColor: '#fff',
        padding: 12,
        displayColors: true,
        callbacks: {
          label: (context) => ` ${context.dataset.label}: ${tooltipFormatter(context.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: gridColor, drawBorder: false },
        ticks: { color: accentText, autoSkip: true, maxTicksLimit: 14, maxRotation: 0, font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: gridColor, drawBorder: false },
        ticks: {
          color: accentText,
          maxTicksLimit: 8,
          font: { size: 11 },
          callback: (value) => yFormatter(value),
        },
      },
    },
  };

  return (
    <figure className="annuities-chart">
      <figcaption className="annuities-chart-heading">
        <h3 className="annuities-chart-title">{title}</h3>
        {description && <p className="annuities-chart-description">{description}</p>}
      </figcaption>

      {hasData ? (
        <div className="annuities-chart-canvas">
          {/* Only drawn once the palette is readable, and keyed by theme so a
              theme flip rebuilds the canvas rather than repainting a stale one. */}
          {ready && <Line key={version} data={data} options={options} />}
        </div>
      ) : (
        <div className="annuities-chart-placeholder">{emptyMessage}</div>
      )}

      {footnote && hasData && <p className="annuities-chart-footnote">{footnote}</p>}
    </figure>
  );
}

export default AnnuityChart;
