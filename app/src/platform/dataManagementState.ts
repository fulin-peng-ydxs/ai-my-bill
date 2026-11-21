import { reactive } from 'vue'
import type { RequestError } from '../api/errors'

/** 数据集切换会销毁设置实例，操作错误仍须由新实例承接，不能随旧弹层消失。 */
export const dataManagementState = reactive({ operationError: undefined as RequestError | undefined })
