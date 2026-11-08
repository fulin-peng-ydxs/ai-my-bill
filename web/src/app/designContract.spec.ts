import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const designPath = fileURLToPath(new URL('../../../DESIGN.md', import.meta.url))
const design = readFileSync(designPath, 'utf8')

// 这些已实现组件的登记要求由现行前端承接；归档原型不消费当前 DESIGN。
const requiredComponents = [
  'FormSection',
  'GlobalLedgerSearch',
  'AppliedFilterBar',
  'SegmentedControl',
  'SettingsDisclosureList',
  'DailyEntryPicker',
  'LedgerContextActions',
  'IncrementalLedgerList',
] as const

function missingRequiredComponents(markdown: string): string[] {
  const registry = markdown.match(/<!-- component-registry:start -->([\s\S]*?)<!-- component-registry:end -->/)?.[1]
  if (registry === undefined) throw new Error('DESIGN component registry markers are missing')

  // 只认登记表第一列，支持 FormSection / FormDisclosure 这样的共用行。
  // 页面索引、使用说明或其他列中的提及不能替代组件登记。
  const names = new Set(
    [...registry.matchAll(/^\|\s*([^|]+)\|/gm)]
      .flatMap((row) => [...row[1]!.matchAll(/`([^`]+)`/g)].map((name) => name[1]!)),
  )
  return requiredComponents.filter((name) => !names.has(name))
}

describe('DESIGN component registry contract', () => {
  it('registers the required current components in the component table', () => {
    expect(missingRequiredComponents(design), 'Missing DESIGN component registrations').toEqual([])
  })

  it.each(requiredComponents)('rejects a missing %s registration despite mentions elsewhere', (component) => {
    const incomplete = design.split('\n')
      .filter((line) => !line.startsWith('|') || !line.split('|')[1]?.includes(`\`${component}\``))
      .join('\n')
    // 由负例构造表外提及，不要求真实文档保留重复说明。
    const withExternalMention = `${incomplete}\n\nExample usage: \`${component}\`.\n`

    expect(incomplete).not.toBe(design)
    expect(missingRequiredComponents(incomplete)).toEqual([component])
    expect(missingRequiredComponents(withExternalMention)).toEqual([component])
  })

  it('does not accept component names in descriptions or outside the registry', () => {
    const mentions = requiredComponents.map((name) => `\`${name}\``).join(' / ')
    const misplaced = `${mentions}
<!-- component-registry:start -->
| Component | Responsibility | Usage |
| --- | --- | --- |
| \`OtherComponent\` | ${mentions} | See the components above |
<!-- component-registry:end -->`

    expect(missingRequiredComponents(misplaced)).toEqual([...requiredComponents])
  })

  it.each(['start', 'end'])('rejects a missing registry %s marker', (boundary) => {
    const incomplete = design.replace(`<!-- component-registry:${boundary} -->`, '')
    expect(() => missingRequiredComponents(incomplete)).toThrow('DESIGN component registry markers are missing')
  })
})
