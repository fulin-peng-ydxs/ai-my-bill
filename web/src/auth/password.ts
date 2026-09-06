import { unicodeCodePointLength } from '../domain/text'

export function isFormalPasswordLengthValid(password: string): boolean {
  const codePointLength = unicodeCodePointLength(password)
  return codePointLength >= 15 && codePointLength <= 64
}
