import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { installInputModality } from './composables/inputModality'
import { installBeforeUnloadGuard } from './composables/unsavedChanges'
import { usePwaInstallStore } from './pwa/install'
import { registerServiceWorker } from './pwa/register'
import router from './router'
import './styles/tokens.css'
import './styles/motion.css'
import { useThemeStore } from './stores/theme'

const pinia = createPinia()
useThemeStore(pinia).initialize()
usePwaInstallStore(pinia).initialize()
installBeforeUnloadGuard()
installInputModality()
createApp(App).use(pinia).use(router).mount('#app')
void registerServiceWorker()
