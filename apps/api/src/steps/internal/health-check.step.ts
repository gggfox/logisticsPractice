import { http, type Handlers, type StepConfig } from 'motia'

export const config = {
  name: 'HealthCheck',
  description: 'API health check endpoint',
  triggers: [http('GET', '/api/v1/health')],
  flows: ['internal-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = {
  async api(_req, res) {
    return res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
    })
  },
}
