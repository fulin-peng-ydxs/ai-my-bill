import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useThemeStore } from './stores/theme'
import { installInputModality } from './composables/inputModality'
import { installBeforeUnloadGuard } from './composables/unsavedChanges'
import './styles/tokens.css'
import './styles/focus.css'
import './styles/motion.css'
const pinia = createPinia()
useThemeStore(pinia).initialize()
installInputModality()
installBeforeUnloadGuard()
createApp(App).use(pinia).use(router).mount('#app')
