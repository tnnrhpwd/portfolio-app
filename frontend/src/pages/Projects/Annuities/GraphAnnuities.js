import React from 'react';
import { Line } from 'react-chartjs-2';
import 'chartjs-adapter-moment';
import { Chart, registerables } from 'chart.js';
import './GraphAnnuities.css';

Chart.register(...registerables);

const GraphAnnuities = ({ chartData, tenseAnnuity }) => {
  // Define isReverse early, before it's used
  const isReverse = tenseAnnuity === '$Present';
  
  // Check if data exists and has the right format
  const isValidData = Array.isArray(chartData) && chartData.length > 0;
  
  // Add padding periods before and after if needed
  const processChartData = () => {
    if (!isValidData) return { paddedData: [], labels: [] };
    
    const hasObjectFormat = chartData[0] && typeof chartData[0] === 'object';
    
    // Calculate min and max periods
    let minPeriod = 0;
    let maxPeriod = 0;
    let finalValue = 0;
    
    if (hasObjectFormat && chartData[0].hasOwnProperty('period')) {
      // Find the min and max periods from the data
      minPeriod = Math.min(...chartData.map(d => d.period));
      maxPeriod = Math.max(...chartData.map(d => d.period));
      
      // Get the final value (value at maximum period)
      const finalEntry = chartData.find(d => d.period === maxPeriod);
      finalValue = finalEntry ? finalEntry.value : 0;
    } else {
      maxPeriod = chartData.length - 1;
      finalValue = chartData[maxPeriod] || 0;
    }
    
    // Add padding (2 periods before and after if possible)
    const paddedMaxPeriod = maxPeriod + 2;
    
    // Create array with all periods in range
    const allPeriods = [];
    let startPeriod = Math.max(0, minPeriod - 2);
    if (isReverse) {
        startPeriod = 1;
    }
    for (let i = startPeriod; i <= paddedMaxPeriod; i++) {
      allPeriods.push(i);
    }
    
    // Create padded data with zeros for missing periods
    const paddedData = allPeriods.map(period => {
      if (hasObjectFormat) {
        const existing = chartData.find(d => d.period === period);
        
        if (existing) {
          return existing.value; // Use existing value if found
        } else if (period > maxPeriod) {
          return finalValue; // Use final value for periods after the last calculated period
        } else {
          return 0; // Use zero for periods before the first calculated period
        }
      } else {
        if (period >= 0 && period < chartData.length) {
          return chartData[period]; // Use existing value if in range
        } else if (period >= chartData.length) {
          return finalValue; // Use final value for periods after the last calculated period
        } else {
          return 0; // Use zero for periods before the first calculated period
        }
      }
    });
    
    // Generate labels
    const labels = allPeriods.map(p => `Period ${p}`);
    
    return { paddedData, labels };
  };
  
  const { paddedData, labels } = processChartData();
  
  // Format the data for Chart.js
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
    animation: {
      duration: 500 // Faster animation for more responsive feel
    },
    scales: {
      x: {
        reverse: isReverse,
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
        <Line data={data} options={options} key={`chart-${paddedData.length}-${JSON.stringify(paddedData)}`} />
      </div>
    </div>
  );
};

export default GraphAnnuities;