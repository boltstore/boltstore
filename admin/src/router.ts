import { createRouter, createWebHistory } from "vue-router"

const router = createRouter({
  history: createWebHistory("/dashboard"),
  routes: [
    { path: "/", redirect: "/overview" },
    { path: "/login", name: "login", component: () => import("./views/Login.vue") },
    {
      path: "/overview",
      name: "overview",
      component: () => import("./views/Overview.vue"),
    },
    {
      path: "/analytics",
      name: "analytics",
      component: () => import("./views/Analytics.vue"),
    },
    {
      path: "/activities",
      name: "activities",
      component: () => import("./views/Activities.vue"),
    },
    {
      path: "/databases",
      name: "databases",
      component: () => import("./views/Databases.vue"),
    },
    {
      path: "/databases/:name/:tab?",
      name: "database-detail",
      component: () => import("./views/DatabaseDetail.vue"),
    },
    {
      path: "/settings/:tab?",
      component: () => import("./views/Settings.vue"),
    },
    { path: "/:pathMatch(.*)*", name: "not-found", component: () => import("./views/NotFound.vue") },
    { path: "/error/:code", name: "error", component: () => import("./views/ErrorPage.vue") },
  ],
})

export default router
