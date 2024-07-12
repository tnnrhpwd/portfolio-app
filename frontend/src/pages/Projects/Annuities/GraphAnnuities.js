import React from 'react';
import { Line } from 'react-chartjs-2';
import 'chartjs-adapter-moment';
import { Chart, registerables } from 'chart.js';
import './GraphAnnuities.css';

Chart.register(...registerables);

const GraphAnnuities = ({ chartData, chartValue }) => {
  const data = {
    labels: chartData.map((dataPoint, index) => `Period ${index + 1}`),
    datasets: [
      {
        label: 'Annuity Value',
        data: chartData,
        fill: false,
        backgroundColor: 'rgba(75,192,192,0.4)',
        borderColor: 'rgba(75,192,192,1)',
        tension: 0.1
      }
    ]
  };

  const options = {
    scales: {
      x: {
        beginAtZero: true
      },
      y: {
        beginAtZero: true
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'top'
      }
    }
  };

  return (
    <div className="graph-container">
      <div className="graph-title">Annuity Value Over Time</div>
      <div className="graph-description">
        This graph shows the value of the annuity over the specified periods.
        {chartData}
        {chartValue}
      </div>
      <div className="chart-wrapper">
        <Line data={data} options={options} />
      </div>
    </div>
  );
};

export default GraphAnnuities;