export function isFormalPasswordLengthValid(password: string): boolean {
  const codePointLength = Array.from(password).length
  return codePointLength >= 15 && codePointLength <= 64
}
