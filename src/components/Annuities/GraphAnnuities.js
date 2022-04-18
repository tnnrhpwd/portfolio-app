import React from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import "./GraphAnnuities.css";


function GraphAnnuities(props) {

  let temp = props.chartData;

  const chartData = {
    labels: ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'],
    datasets: [{
      data: [12,26,45,56,1,5],
    }]
  };

  return (
    <div>
      {temp}
      {/* <Bar data={chartData} /> */}
    </div>
  )
}

export default GraphAnnuities;