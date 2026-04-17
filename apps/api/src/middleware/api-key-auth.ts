import type { ApiMiddleware } from 'motia'
import { config } from '../config.js'

export const apiKeyAuth: ApiMiddleware = async (req, ctx, next) => {
  if (ctx.trigger.path === '/api/v1/health') {
    return next()
  }

  const apiKey = req.headers['x-api-key']

  if (!apiKey) {
    return {
      status: 401,
      body: {
        error: 'Unauthorized',
        message: 'Missing x-api-key header',
        statusCode: 401,
      },
    }
  }

  const validKeys = [config.bridge.apiKey, config.bridge.adminKey]

  if (!validKeys.includes(apiKey as string)) {
    return {
      status: 401,
      body: {
        error: 'Unauthorized',
        message: 'Invalid API key',
        statusCode: 401,
      },
    }
  }

  return next()
}
