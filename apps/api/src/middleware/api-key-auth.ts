import type { HttpMiddleware } from 'motia'

export const apiKeyAuth: HttpMiddleware = async (req, res, next) => {
  if (req.path === '/health' || req.path === '/api/v1/health') {
    return next()
  }

  const apiKey = req.headers['x-api-key']

  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing x-api-key header',
      statusCode: 401,
    })
  }

  const validKeys = [process.env.BRIDGE_API_KEY, process.env.ADMIN_API_KEY].filter(Boolean)

  if (!validKeys.includes(apiKey as string)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
      statusCode: 401,
    })
  }

  return next()
}
