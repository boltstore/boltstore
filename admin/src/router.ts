import { createRouter, createWebHistory } from "vue-router";

const routes = [
  { path: "/", redirect: "/login" },
  { path: "/login", name: "Login", component: () => import("./views/Login.vue") },
  { path: "/overview", name: "Overview", component: () => import("./views/Overview.vue") },
  { path: "/databases", name: "Databases", component: () => import("./views/Databases.vue") },
  {
    path: "/databases/:name",
    component: () => import("./views/DatabaseDetail.vue"),
  },

  { path: "/activity", name: "ActivityLog", component: () => import("./views/ActivityLog.vue") },
];

const router = createRouter({
  history: createWebHistory("/dashboard"),
  routes,
});

export default router;
