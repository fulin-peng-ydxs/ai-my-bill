import type { InjectionKey } from 'vue'

/** 候选展开后，抽屉保持空间至关闭，避免外部点按过程中控件移位。 */
export const reserveDrawerCandidateSpace: InjectionKey<() => void> = Symbol('reserveDrawerCandidateSpace')
