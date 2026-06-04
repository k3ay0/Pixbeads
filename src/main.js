import { createApp, defineAsyncComponent } from "vue"
import App from "./App.vue"
import "./style.css"

const app = createApp(App)

// 简易路由：根据 path 判断是否挂载 FocusMode
if (window.location.pathname === '/focus') {
  const FocusMode = defineAsyncComponent(() => import('./views/FocusMode.vue'))
  const focusApp = createApp(FocusMode)
  focusApp.mount("#app")
} else {
  app.mount("#app")
}
