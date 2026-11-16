import type { InjectionKey, Ref } from 'vue'

/** 页面主动作使用独立布局区域，编辑弹层继续消费自身操作栏。 */
export const pageActionTarget: InjectionKey<Ref<globalThis.HTMLElement | undefined>> = Symbol('page-action-target')

/** 非阻塞的页面状态随标题呈现，状态和恢复动作仍由所属表单维护。 */
export const pageNoticeTarget: InjectionKey<Ref<globalThis.HTMLElement | undefined>> = Symbol('page-notice-target')
