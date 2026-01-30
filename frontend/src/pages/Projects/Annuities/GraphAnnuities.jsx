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

  // Check if data is valid
  const isValidData = Array.isArray(chartData) && chartData.length > 0 && 
    typeof chartData[0] === 'object' && 'period' in chartData[0] && 'value' in chartData[0];
  
  // Process chart data to include padding periods
  const processChartData = () => {
    if (!isValidData) return { paddedData: [], labels: [] };
    
    // Calculate min and max periods
    const minPeriod = Math.min(...chartData.map(d => d.period));
    const maxPeriod = Math.max(...chartData.map(d => d.period));
    
    // Get the final value (value at maximum period)
    const finalEntry = chartData.find(d => d.period === maxPeriod);
    const finalValue = finalEntry ? finalEntry.value : 0;
    
    // Add padding (2 periods before and after if possible)
    const paddedMinPeriod = Math.max(0, minPeriod - 2);
    const paddedMaxPeriod = maxPeriod + 2;
    
    // Create array with all periods in range
    const allPeriods = [];
    for (let i = paddedMinPeriod; i <= paddedMaxPeriod; i++) {
      allPeriods.push(i);
    }
    
    // Create padded data with zeros for missing periods before the range
    // and the final value for periods after the range
    const paddedData = allPeriods.map(period => {
      const existing = chartData.find(d => d.period === period);
      
      if (existing) {
        return existing.value; // Use existing value if found
      } else if (period > maxPeriod) {
        return finalValue; // Use final value for periods after the last calculated period
      } else {
        return 0; // Use zero for periods before the first calculated period
      }
    });
    
    return { 
      paddedData,
      labels: allPeriods.map(p => `Period ${p}`)
    };
  };
  
  const { paddedData, labels } = processChartData();
  
  // Log data issues for debugging
  useEffect(() => {
    if (!Array.isArray(chartData)) {
      console.error('chartData is not an array:', chartData);
    } else if (chartData.length === 0) {
      console.log('chartData is empty');
    } else if (isValidData) {
      console.log('Valid chartData:', chartData);
      console.log('Processed with padding:', { paddedData, labels });
    } else {
      console.error('Invalid chartData format:', chartData);
    }
  }, [chartData, isValidData, paddedData, labels]);

  const data = {
    labels: labels,
    datasets: [
      {
        label: 'Annuity Value',
        data: paddedData,
        fill: false,
        backgroundColor: 'rgba(75,192,192,0.4)',
        borderColor: 'rgba(75,192,192,1)',
        tension: 0.1
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: {
        beginAtZero: true,
        grid: {
          color: 'rgba(200, 200, 200, 0.2)'
        },
        ticks: {
          font: {
            size: 12
          }
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(200, 200, 200, 0.2)'
        },
        ticks: {
          font: {
            size: 12
          },
          // Add dollar formatting
          callback: function(value) {
            return '$' + value.toFixed(2);
          }
        }
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          boxWidth: 20,
          font: {
            size: 14
          }
        }
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: 10,
        titleFont: {
          size: 14
        },
        bodyFont: {
          size: 13
        },
        displayColors: false,
        callbacks: {
          label: function(context) {
            return `$${context.parsed.y.toFixed(2)}`;
          }
        }
      }
    }
  };

  if (!isValidData) {
    return (
      <div className="graph-container">
        <div className="graph-title">Annuity Value Over Time</div>
        <div className="graph-description">
          Enter values in the form above to see your annuity visualization.
        </div>
        <div className="chart-placeholder">
          No data to display yet
        </div>
      </div>
    );
  }

  return (
    <div className="graph-container">
      <div className="graph-title">Annuity Value Over Time</div>
      <div className="graph-description">
        This graph shows the value of the annuity over the specified periods.
      </div>
      <div className="chart-wrapper">
        <Line data={data} options={options} />
      </div>
    </div>
  );
};

export default GraphAnnuities;
