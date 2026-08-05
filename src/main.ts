import { createApp } from "vue"
import { createPinia } from 'pinia'
import Root from "./Root.vue"
import router from "./router"
import "./css/style.css"

const app = createApp(Root)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount("#app")
