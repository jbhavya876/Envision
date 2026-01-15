/**
 * @file BalanceChart Component
 * @description Real-time line chart displaying user balance over time.
 * Uses Chart.js for visualization with gradient fill and smooth animations.
 * 
 * @component
 * @param {Object} props
 * @param {Object} props.chartData - Chart data object
 * @param {Array<number>} props.chartData.labels - X-axis labels (nonces)
 * @param {Array<number>} props.chartData.data - Y-axis data (balances)
 */

import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

const BalanceChart = ({ chartData }) => {
    const chartRef = useRef(null);
    const chartInstanceRef = useRef(null);

    useEffect(() => {
        if (!chartRef.current) return;

        const ctx = chartRef.current.getContext('2d');

        // Create Gradient for the line
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(0, 231, 1, 0.5)');
        gradient.addColorStop(1, 'rgba(0, 231, 1, 0.0)');

        // Destroy existing chart if it exists
        if (chartInstanceRef.current) {
            chartInstanceRef.current.destroy();
        }

        chartInstanceRef.current = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [
                    {
                        label: 'Live Balance',
                        data: chartData.data,
                        borderColor: '#00e701',
                        backgroundColor: gradient,
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: true,
                        tension: 0.1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: (c) => ` $${c.raw.toFixed(2)}` },
                    },
                },
                scales: {
                    x: { display: false },
                    y: {
                        grid: { color: '#2f4553' },
                        ticks: { color: '#888', callback: (v) => '$' + v },
                    },
                },
            },
        });

        return () => {
            if (chartInstanceRef.current) {
                chartInstanceRef.current.destroy();
            }
        };
    }, []);

    useEffect(() => {
        if (chartInstanceRef.current) {
            chartInstanceRef.current.data.labels = chartData.labels;
            chartInstanceRef.current.data.datasets[0].data = chartData.data;
            chartInstanceRef.current.update();
        }
    }, [chartData]);

    return (
        <div className="chart-container">
            <canvas ref={chartRef}></canvas>
        </div>
    );
};

export default BalanceChart;
