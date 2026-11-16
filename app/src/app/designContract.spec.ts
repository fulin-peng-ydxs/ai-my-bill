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

describe('沿用原界面的 iPhone 设计契约', () => {
 it('关键共享组件的模板与全局样式保持原基线，不建立第二套视觉', () => {
   for (const [name, hash] of Object.entries(baseline.components)) {
     const file = read(`components/${name}.vue`)
     expect(digest(file.includes('<template>') ? file.slice(file.indexOf('<template>')) : file), name).toBe(hash)
   }
   for (const [name, hash] of Object.entries(baseline.styles)) expect(digest(read('styles/'+name))).toBe(hash)
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
