import React from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler);

function BalanceChart({ chartData }) {
  const data = {
    labels: chartData.labels,
    datasets: [
      {
        label: "Balance ($)",
        data: chartData.data,
        fill: true,
        borderColor: "#00ff88",
        backgroundColor: "rgba(0, 255, 136, 0.2)",
        tension: 0.3,
      },
    ],
  };

  const options = {
    responsive: true,
    scales: {
      y: {
        ticks: {
          callback: (value) => "$" + value,
        },
      },
    },
  };

  return <Line data={data} options={options} />;
}

export default BalanceChart;