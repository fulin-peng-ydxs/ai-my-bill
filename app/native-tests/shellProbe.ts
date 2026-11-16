import type { Router } from 'vue-router'
import { createApp, h, nextTick, ref } from 'vue'
import AppDrawer from '../src/components/AppDrawer.vue'
import AppDialog from '../src/components/AppDialog.vue'
import UnsavedChangesDialog from '../src/components/UnsavedChangesDialog.vue'
import { registerUnsavedChanges, requestDiscardChanges } from '../src/composables/unsavedChanges'

import { requireValue, waitFor, click, type } from './domHarness'

/** 只在 XCTest test bundle 中：验证真实路由/缓存/原生 dialog，不替代触摸及软键盘实测。 */
export async function shell() {
  const app = (document.querySelector('#app') as Element & { __vue_app__?: { config: { globalProperties: { $router: Router } } } }).__vue_app__
  requireValue(app, 'Vue 入口未挂载')
  const router = app.config.globalProperties.$router
  const nav = [...document.querySelectorAll('.bottom-navigation a')]
  requireValue(nav.map(item => item.textContent?.trim()).join(',') === '记一笔,报表,明细,我的', '导航名称或顺序变化')
  requireValue(nav.every(item => item.querySelector('svg')), '导航原图标缺失')

  type('#expense-unit-price', '12.3456')
  type('#expense-quantity', '1.250')
  await waitFor(() => document.querySelector('.entry-receipt')?.textContent?.includes('15.43') === true, '原票据金额未计算')
  const headings: string[] = []
  for (const [path, heading] of [['/reports','收支报表'], ['/ledger','收支明细'], ['/me','我的'], ['/entry','记一笔']]) {
    click(`.bottom-navigation a[href="${path}"]`)
    await waitFor(() => document.querySelector('h1')?.textContent?.trim() === heading, `页面 ${path} 未就绪`)
    headings.push(heading!)
    requireValue(!document.querySelector('input[type=password]'), '存在登录/密码入口')
    requireValue(document.documentElement.scrollWidth <= innerWidth + 1, `${path} 横向溢出`)
  }
  requireValue(document.querySelector<HTMLInputElement>('#expense-unit-price')?.value === '12.3456', '返回丢失单价')
  requireValue(document.querySelector<HTMLInputElement>('#expense-quantity')?.value === '1.250', '返回丢失数量')

  await router.push('/me')
  await waitFor(() => !!document.querySelector('.settings-page'), '设置未就绪')
  const setting = [...document.querySelectorAll<HTMLButtonElement>('.settings-page button')].find(item => item.textContent?.includes('外观'))
  requireValue(setting, '原外观入口缺失')
  setting.focus(); setting.click()
  await waitFor(() => !!document.querySelector('#profile-setting[open]'), '原外观抽屉未打开')
  for (const [label, value] of [['夜晚','dark'], ['白天','light'], ['跟随系统',matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light']]) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('#profile-setting button')].find(item => item.textContent?.trim() === label)
    requireValue(button, `主题控件 ${label} 缺失`)
    button.click()
    await waitFor(() => document.documentElement.dataset.theme === value, '主题未更新')
  }
  click('#profile-setting button[aria-label="关闭"]')
  await waitFor(() => !document.querySelector('#profile-setting[open]'), '抽屉关闭未完成')
  await waitFor(() => document.activeElement === setting, '关闭后焦点没有返回原入口')

  // 业务尚未接通，嵌套编辑采用 test bundle 中的共享组件夹具，不伪造账目数据。
  await nestedOverlay()
  await router.push('/entry')
  await waitFor(() => !!document.querySelector('#expense-unit-price'), '记账页未恢复')
  requireValue(document.querySelector<HTMLInputElement>('#expense-unit-price')?.value === '12.3456', '子层放弃误清理主表单草稿')
  requireValue(performance.getEntriesByType('resource').every(item => !/^https?:/.test(item.name)), '出现远程资源')
  return { headings, width: innerWidth, height: innerHeight, draftsRetained: true, themes: 3, nestedDiscard: true, focusRestored: true, remoteResources: 0 }
}

/** 原生 top layer + 共享关闭协议夹具；仅在探针 bundle，退出后卸载并清除注册。 */
async function nestedOverlay() {
  const parent = ref(true), child = ref(false), dirty = ref(true)
  const childText = ref('未保存夹具')
  const stop = registerUnsavedChanges(dirty, () => { dirty.value = false; childText.value = '' }, 't4-child')
  const host = document.createElement('div')
  document.body.append(host)
  const fixture = createApp({ render: () => [
    h(AppDrawer, { id:'t4-parent', open:parent.value, title:'父层夹具', 'onUpdate:open':(v:boolean) => { parent.value=v } }, { default:() => h('button', { id:'t4-open-child', onClick:() => {child.value=true} }, '编辑子层') }),
    h(AppDialog, { id:'t4-child', open:child.value, title:'子层夹具', 'onUpdate:open': async () => { if (await requestDiscardChanges('navigation','t4-child')) child.value=false } }, { default:() => h('input', { value:childText.value }) }),
    h(UnsavedChangesDialog),
  ] })
  try {
    fixture.mount(host)
    await nextTick()
    await waitFor(() => !!document.querySelector('#t4-parent[open]'), '父层未打开')
    click('#t4-open-child')
    await waitFor(() => !!document.querySelector('#t4-child[open]'), '子层未打开')
    click('#t4-child .secondary-button')
    await waitFor(() => host.querySelector('#unsaved-changes-confirm[open]') !== null, '未保存保护未打开')
    host.querySelector<HTMLButtonElement>('#unsaved-changes-confirm .secondary-button')!.click()
    await waitFor(() => host.querySelector('#unsaved-changes-confirm[open]') === null, '确认层未关闭')
    requireValue(document.querySelector('#t4-child[open]') && childText.value === '未保存夹具', '取消丢失父层或内容')
    click('#t4-child .secondary-button')
    await waitFor(() => host.querySelector('#unsaved-changes-confirm[open]') !== null, '再次关闭未触发保护')
    host.querySelector<HTMLButtonElement>('#unsaved-changes-confirm .primary-button')!.click()
    await waitFor(() => !document.querySelector('#t4-child[open]'), '子层未关闭')
    requireValue(document.querySelector('#t4-parent[open]') && !dirty.value, '子层放弃误关闭父层或未清理指定草稿')
    click('#t4-parent button[aria-label="关闭"]')
    await waitFor(() => !document.querySelector('#t4-parent[open]'), '父层未关闭')
  } finally { fixture.unmount(); host.remove(); stop() }
}
