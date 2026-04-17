import { RATE_LIMIT } from '@carrier-sales/shared'
import type { ApiMiddleware } from 'motia'

const windows = new Map<string, { count: number; resetAt: number }>()

export const rateLimiter: ApiMiddleware = async (req, _ctx, next) => {
  const key = (req.headers['x-api-key'] as string) ?? 'anonymous'
  const now = Date.now()

  let window = windows.get(key)

  if (!window || now > window.resetAt) {
    window = { count: 0, resetAt: now + RATE_LIMIT.windowMs }
    windows.set(key, window)
  }

  window.count++

  const rateLimitHeaders: Record<string, string> = {
    'X-RateLimit-Limit': String(RATE_LIMIT.maxRequests),
    'X-RateLimit-Remaining': String(Math.max(0, RATE_LIMIT.maxRequests - window.count)),
    'X-RateLimit-Reset': String(Math.ceil(window.resetAt / 1000)),
  }

  if (window.count > RATE_LIMIT.maxRequests) {
    const retryAfter = Math.ceil((window.resetAt - now) / 1000)
    return {
      status: 429,
      headers: {
        ...rateLimitHeaders,
        'Retry-After': String(retryAfter),
      },
      body: {
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        statusCode: 429,
      },
    }
  }

  const result = await next()
  return {
    ...result,
    headers: {
      ...(result.headers ?? {}),
      ...rateLimitHeaders,
    },
  }
}
