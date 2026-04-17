/**
 * BullMQ queue producers and shared Redis connection.
 *
 * Replaces Motia's built-in queue. Three separate queues are used instead
 * of one "call.completed" because BullMQ workers sharing a queue name are
 * competing consumers (not fan-out). Publishing to two queues from the
 * webhook route is cheap and explicit:
 *
 *   call.completed.classify  -> ClassifyCall worker
 *   call.completed.sentiment -> AnalyzeSentiment worker
 *   carrier.verified         -> VerifyCarrierEnrichment worker
 *
 * Workers import the same schemas for input validation so a payload shape
 * change is a single edit.
 */

import { Queue, type QueueOptions } from 'bullmq'
import { Redis, type RedisOptions } from 'ioredis'
import { z } from 'zod'
import { config } from '../config.js'

// BullMQ requires `maxRetriesPerRequest: null` on the shared ioredis
// client it uses for blocking connections; the docs are explicit about
// this. See https://docs.bullmq.io/guide/going-to-production.
const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
}

let sharedConnection: Redis | null = null

export function getRedisConnection(): Redis {
  sharedConnection ??= new Redis(config.redis.url, redisOptions)
  return sharedConnection
}

export async function closeRedisConnection(): Promise<void> {
  if (sharedConnection) {
    await sharedConnection.quit().catch(() => {
      // If the connection was already closed, quit() throws -- swallow.
    })
    sharedConnection = null
  }
}

const defaultQueueOptions = (): QueueOptions => ({
  connection: getRedisConnection(),
  defaultJobOptions: {
    // Exponential backoff is safe because every worker body is idempotent
    // against Convex (upserts keyed by call_id / mc_number / load_id).
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: { age: 24 * 3_600 },
  },
})

// Shared payload shapes. Any change here is a contract change between
// webhook producer and worker consumer.

export const ClassifyCallInputSchema = z.object({
  call_id: z.string(),
  carrier_mc: z.string().optional(),
  load_id: z.string().optional(),
  transcript: z.string().optional(),
  duration_seconds: z.number().optional(),
  started_at: z.string(),
  ended_at: z.string(),
  status: z.string(),
  extracted_data: z.record(z.unknown()).optional(),
})
export type ClassifyCallInput = z.infer<typeof ClassifyCallInputSchema>

export const AnalyzeSentimentInputSchema = z.object({
  call_id: z.string(),
  transcript: z.string().optional(),
})
export type AnalyzeSentimentInput = z.infer<typeof AnalyzeSentimentInputSchema>

export const VerifyCarrierEnrichmentInputSchema = z.object({
  mc_number: z.string(),
  legal_name: z.string(),
})
export type VerifyCarrierEnrichmentInput = z.infer<typeof VerifyCarrierEnrichmentInputSchema>

export const QUEUE_NAMES = {
  classifyCall: 'call.completed.classify',
  analyzeSentiment: 'call.completed.sentiment',
  verifyCarrier: 'carrier.verified',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

let classifyCallQueue: Queue<ClassifyCallInput> | null = null
let analyzeSentimentQueue: Queue<AnalyzeSentimentInput> | null = null
let verifyCarrierQueue: Queue<VerifyCarrierEnrichmentInput> | null = null

export function getClassifyCallQueue(): Queue<ClassifyCallInput> {
  classifyCallQueue ??= new Queue<ClassifyCallInput>(
    QUEUE_NAMES.classifyCall,
    defaultQueueOptions(),
  )
  return classifyCallQueue
}

export function getAnalyzeSentimentQueue(): Queue<AnalyzeSentimentInput> {
  analyzeSentimentQueue ??= new Queue<AnalyzeSentimentInput>(
    QUEUE_NAMES.analyzeSentiment,
    defaultQueueOptions(),
  )
  return analyzeSentimentQueue
}

export function getVerifyCarrierQueue(): Queue<VerifyCarrierEnrichmentInput> {
  verifyCarrierQueue ??= new Queue<VerifyCarrierEnrichmentInput>(
    QUEUE_NAMES.verifyCarrier,
    defaultQueueOptions(),
  )
  return verifyCarrierQueue
}

/**
 * Flush and close all producer queues. Called from the server's shutdown
 * hook before the Redis connection is torn down. Workers have their own
 * `worker.close()` in their respective boot modules.
 */
export async function closeAllQueues(): Promise<void> {
  const queues = [classifyCallQueue, analyzeSentimentQueue, verifyCarrierQueue]
  await Promise.allSettled(queues.map((q) => q?.close()))
  classifyCallQueue = null
  analyzeSentimentQueue = null
  verifyCarrierQueue = null
}
