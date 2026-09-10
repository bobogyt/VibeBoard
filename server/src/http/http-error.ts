/** 带 HTTP 状态码的业务错误:service 层抛出,由全局异常过滤器转为 { error } JSON */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function httpError(status: number, message: string): HttpError {
  return new HttpError(status, message)
}
