export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}
export async function waitFor(condition: () => boolean, message: string) {
  for (let i = 0; i < 100; i++) {
    if (condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error(message)
}
export function click(selector: string) {
  const target = document.querySelector<HTMLElement>(selector)
  requireValue(target, `未找到控件 ${selector}`)
  target.click()
  return target
}
export function type(selector: string, value: string) {
  const target = document.querySelector<HTMLInputElement>(selector)
  requireValue(target, `未找到输入 ${selector}`)
  target.value = value
  target.dispatchEvent(new Event('input', { bubbles: true }))
}
