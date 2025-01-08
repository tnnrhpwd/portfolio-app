import React, { useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import 'chartjs-adapter-moment';
import { Chart, registerables } from 'chart.js';
import './GraphAnnuities.css';

Chart.register(...registerables);

const GraphAnnuities = ({ chartData }) => {
  useEffect(() => {
    console.log('GraphAnnuities component rendered');
  }, []);

  console.log('chartData:', chartData);

  if (!Array.isArray(chartData)) {
    console.error('chartData is not an array:', chartData);
  } else {
    chartData.forEach((dataPoint, index) => {
      if (typeof dataPoint !== 'object' || !('period' in dataPoint) || !('value' in dataPoint)) {
        console.error(`Invalid dataPoint at index ${index}:`, dataPoint);
      }
    });
  }

  const data = {
    labels: chartData.map((dataPoint) => `Period ${dataPoint.period}`),
    datasets: [
      {
        label: 'Annuity Value',
        data: chartData.map((dataPoint) => dataPoint.value),
        fill: false,
        backgroundColor: 'rgba(75,192,192,0.4)',
        borderColor: 'rgba(75,192,192,1)',
        tension: 0.1
      }
    ]
  };

  console.log('data:', data);

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
      </div>
      <div className="chart-wrapper">
        {console.log('Rendering Line component with data:', data)}
        <Line data={data} options={options} />
      </div>
    </div>
  );
};

export default GraphAnnuities;
