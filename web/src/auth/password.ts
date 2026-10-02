import { unicodeCodePointLength } from '../domain/text'

export function isFormalPasswordLengthValid(password: string): boolean {
  const codePointLength = unicodeCodePointLength(password)
  return codePointLength >= 15 && codePointLength <= 64
}

/** 与首次设置复用长度规则；常见密码和当前密码真实性仍由服务端校验。 */
export function validatePasswordChange(value: { currentPassword: string, newPassword: string, confirmPassword: string }): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!value.currentPassword) errors.currentPassword = '请输入当前密码。'
  if (!isFormalPasswordLengthValid(value.newPassword)) errors.newPassword = '新密码须为 15–64 个字符。'
  else if (value.newPassword === value.currentPassword) errors.newPassword = '新密码不能与当前密码相同。'
  if (!value.confirmPassword || value.confirmPassword !== value.newPassword) errors.confirmPassword = '两次输入的新密码不一致。'
  return errors
}
