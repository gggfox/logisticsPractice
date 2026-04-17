import { RATE_LIMIT } from '@carrier-sales/shared'
import type { HttpMiddleware } from 'motia'

const windows = new Map<string, { count: number; resetAt: number }>()

export const rateLimiter: HttpMiddleware = async (req, res, next) => {
  const key = (req.headers['x-api-key'] as string) ?? req.ip ?? 'anonymous'
  const now = Date.now()

  let window = windows.get(key)

  if (!window || now > window.resetAt) {
    window = { count: 0, resetAt: now + RATE_LIMIT.windowMs }
    windows.set(key, window)
  }

  window.count++

  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT.maxRequests))
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT.maxRequests - window.count)))
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(window.resetAt / 1000)))

  if (window.count > RATE_LIMIT.maxRequests) {
    const retryAfter = Math.ceil((window.resetAt - now) / 1000)
    res.setHeader('Retry-After', String(retryAfter))
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
      statusCode: 429,
    })
  }

  return next()
}
