<template>
  <div class="chart-container">
    <Bar v-if="labels.length" :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { Bar } from "vue-chartjs"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Filler,
} from "chart.js"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Filler)

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
      backgroundColor: props.error ? "#ef4444" : "#00d4ff",
      hoverBackgroundColor: props.error ? "#f87171" : "#33ddff",
      borderRadius: 2,
      borderSkipped: false,
    },
  ],
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: {
    duration: 300,
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
        stepSize: 1,
      },
    },
  },
}
</script>

<style scoped>
.chart-container {
  width: 100%;
  height: 100%;
}
</style>
