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
import { useBootstrapStore } from './stores/bootstrap'
import { installDraftLifecycle } from './platform/draftLifecycle'
const pinia = createPinia()
useThemeStore(pinia).initialize()
installInputModality()
installBeforeUnloadGuard()
installDraftLifecycle()
// 首个 Vue 业务帧前恢复 SQLite 偏好/主题，不以浏览器缓存作为第二个事实源。
await useBootstrapStore(pinia).initialize()
createApp(App).use(pinia).use(router).mount('#app')
