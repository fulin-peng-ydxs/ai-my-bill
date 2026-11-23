import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { pageRegistry } from './pageRegistry'
import { assertComponentRegistration, assertNoPrivateColors, assertPageRegistration } from './designPolicy'
import { routes } from '../router'
import baseline from './uiBaseline.json'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const source = ['components', 'views'].flatMap(folder => readdirSync(resolve(root, folder), { recursive: true }).map(String).filter(name => name.endsWith('.vue')).map(name => read(`${folder}/${name}`))).concat(read('App.vue'))
const design = readFileSync(resolve(root,'../../DESIGN.md'),'utf8')

/** 保留原哈希，并证明登记的 iPhone 输入适配只改变已确认的行为绑定。 */
function assertOriginalTemplate(name: string, template: string, originalHash: string): void {
  if (name === 'GlobalLedgerSearch') {
    expect(digest(template), name).toBe(baseline.templateAdaptations.GlobalLedgerSearch.sha256)
    const original = template.replace('      ref="input"\n', '')
      .replace('      @beforeinput="beforeInput"\n', '      :maxlength="maxLength"\n')
      .replace('      @paste="paste"\n', '')
      .replace('      @compositionstart="compositionStart"\n', '')
      .replace('      @compositionend="compositionEnd"\n', '')
    expect(digest(original), name + ' 原布局基线').toBe(originalHash)
  } else {
    expect(digest(template), name).toBe(originalHash)
  }
}

function assertOriginalStyle(name: string, style: string, originalHash: string): void {
  if (name !== 'tokens.css') { expect(digest(style), name).toBe(originalHash); return }
  expect(digest(style)).toBe(baseline.styleAdaptations['tokens.css'].sha256)
  const marker = '\n/* iOS keyboard adaptation: apply the existing keyboard rules in landscape too. */\n'
  const parts = style.split(marker)
  expect(parts).toHaveLength(2)
  const lowHeight = '\n/* 低高度编辑时暂时让出固定页头，收键盘后恢复原位置。 */\n@media (max-height: 599px) {\n  .app-shell.keyboard-open [data-page-key="ledger-entry"] > .page-workspace-header { display: none; }\n  .app-shell.keyboard-open .anchored-dropdown .dropdown-toolbar { position: static; }\n}\n'
  expect(parts[1]!.endsWith(lowHeight)).toBe(true)
  const rules = parts[1]!.slice(0,-lowHeight.length).trimEnd().split('\n').map(line => '  '+line).join('\n')
  const original = parts[0]!.replace('\n\n}\n\n/* 小图标识别任务', rules+'\n\n}\n\n/* 小图标识别任务')
  expect(digest(original), '原键盘规则与完整布局基线').toBe(originalHash)
}

describe('沿用原界面的 iPhone 设计契约', () => {
 it('关键共享组件的模板与全局样式保持原基线，不建立第二套视觉', () => {
   for (const [name, hash] of Object.entries(baseline.components)) {
     const file = read(`components/${name}.vue`)
     assertOriginalTemplate(name, file.includes('<template>') ? file.slice(file.indexOf('<template>')) : file, hash)
   }
   for (const [name, hash] of Object.entries(baseline.styles)) assertOriginalStyle(name,read('styles/'+name),hash)
 })
 it('横屏键盘例外不豁免其他布局或字号变化', () => {
   const style = read('styles/tokens.css')
   expect(() => assertOriginalStyle('tokens.css',style.replace('display: none;', 'display: block;'),baseline.styles['tokens.css'])).toThrow()
   expect(() => assertOriginalStyle('tokens.css',style.replace('position: static;', 'position: fixed;'),baseline.styles['tokens.css'])).toThrow()
 })
 it('已登记输入适配不豁免搜索框布局或其他行为变化', () => {
   const file = read('components/GlobalLedgerSearch.vue')
   const template = file.slice(file.indexOf('<template>'))
   const hash = baseline.components.GlobalLedgerSearch
   expect(() => assertOriginalTemplate('GlobalLedgerSearch', template.replace('class="global-search"', 'class="changed-layout"'), hash)).toThrow()
   expect(() => assertOriginalTemplate('GlobalLedgerSearch', template.replace('@input="onInput"', '@input="otherInput"'), hash)).toThrow()
 })
 it('登记与真实导入/渲染相符，注释和同名标签不能替代消费', () => {
   const required = ['AppShell','BottomNavigation','PageWorkspace','AppDrawer','AppDialog','EntryReceipt','EntrySaveBar','FormField','AppStateBlock']
   expect(() => assertComponentRegistration(source, design, required)).not.toThrow()
   expect(() => assertComponentRegistration(source, design.replace('`PageWorkspace`','`Other`'), required)).toThrow()
   expect(() => assertComponentRegistration(['<!-- import AppDrawer from "./AppDrawer.vue" -->\n<template><AppDrawer /></template>'], design, ['AppDrawer'])).toThrow()
 })
 it('组件颜色只消费 token，受控私有颜色反例被拒绝', () => {
   for (const file of source) expect(() => assertNoPrivateColors(file)).not.toThrow()
   expect(() => assertNoPrivateColors('<template><div /></template><style>.x{color:#ff0000}</style>')).toThrow('私有颜色')
   expect(() => assertNoPrivateColors('<template><div /></template><style>.x{color:var(--color-text)}</style>')).not.toThrow()
   expect(() => assertNoPrivateColors('<template><div /></template><style>#abc{background:url("icons.svg#abc");content:"#abc";color:var(--color-text)}</style>')).not.toThrow()
 })
 it('个人页面维持四态、路径与四个导航顺序，没有身份或管理员登记', () => {
   const names = routes.flatMap(route => 'name' in route ? [String(route.name)] : [])
   expect(() => assertPageRegistration(pageRegistry, names, design)).not.toThrow()
   expect(() => assertPageRegistration([...pageRegistry, pageRegistry[0]], names, design)).toThrow('重复')
   expect(() => assertPageRegistration(pageRegistry, names.slice(1), design)).toThrow('路由')
   expect(pageRegistry.filter(p=>p.navigation==='primary').map(p=>p.path)).toEqual(['/entry','/reports','/ledger','/me'])
   for (const page of pageRegistry) expect(page.states).toEqual(['ready','loading','empty','error'])
   expect(read('router/index.ts')).not.toMatch(/useSessionStore|requiresAuthentication|\/login|\/admin/)
 })
})
