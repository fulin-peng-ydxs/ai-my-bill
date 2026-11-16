import { inject, ref, type InjectionKey, type Ref } from 'vue'

export const pageActivityKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('page-activity')
/** 异步响应只能更新数据，不能让隐藏缓存页抢走当前页面的滚动/焦点。 */
export function usePageActivity(): Readonly<Ref<boolean>> {
  return inject(pageActivityKey, ref(true))
}
