<template>
  <div class="chart-container">
    <Line v-if="labels.length" :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { Line } from "vue-chartjs"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Filler,
} from "chart.js"

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Title, Tooltip, Filler)

const props = withDefaults(
  defineProps<{
    labels: string[]
    values: number[]
    max: number
    error?: boolean
  }>(),
  {
    error: false,
  }
)

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [
    {
      data: props.values,
      borderColor: props.error ? "#ef4444" : "#00d4ff",
      backgroundColor: props.error ? "rgba(239,68,68,0.08)" : "rgba(0,212,255,0.08)",
      fill: true,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
      borderWidth: 2,
    },
  ],
}))

const stepSize = computed(() => {
  const m = props.max;
  if (m <= 10) return 1;
  if (m <= 50) return 5;
  if (m <= 200) return 10;
  if (m <= 1000) return 50;
  return Math.ceil(m / 20);
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: {
    duration: 300,
  },
  interaction: {
    mode: "nearest" as const,
    intersect: false,
  },
  plugins: {
    tooltip: {
      callbacks: {
        title: () => "",
        label: (ctx: any) => `${ctx.parsed.y} queries`,
      },
    },
    legend: { display: false },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: {
        color: "#6b7280",
        font: { size: 10 },
        maxRotation: 0,
      },
    },
    y: {
      grid: { color: "#1f2937" },
      ticks: {
        color: "#6b7280",
        font: { size: 10 },
        stepSize: stepSize.value,
      },
    },
  },
}))
</script>

<style scoped>
.chart-container {
  width: 100%;
  height: 100%;
}
</style>
