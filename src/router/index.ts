import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import App from '../App.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: App,
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
