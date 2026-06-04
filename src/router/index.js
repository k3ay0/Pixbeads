import { createRouter, createWebHistory } from 'vue-router'
import App from '../App.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: App,
  },
  {
    path: '/focus',
    name: 'Focus',
    component: () => import('../views/FocusMode.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
