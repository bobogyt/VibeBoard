/** 请求体编码防护:U+FFFD 替换符是「字节流被错误解码」的残留特征(如 GBK 字节按 UTF-8 解码失败),
 *  含替换符的写入一旦入库就会永久乱码,故在 HTTP 边界整体拒绝 */
export function bodyContainsReplacementChar(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\uFFFD')
  if (Array.isArray(value)) return value.some((item) => bodyContainsReplacementChar(item))
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => bodyContainsReplacementChar(item))
  }
  return false
}
