import 'dotenv/config'
import type { Worker as BullWorker } from 'bullmq'
import Redis from 'ioredis'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

const REDIS_QUOTA_ERROR_PATTERN = /max requests limit exceeded/i
const DEFAULT_REDIS_QUOTA_COOLDOWN_MS = 10 * 60_000
const WORKER_CLOSE_TIMEOUT_MS = 10_000
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1'
const REDIS_PORT = Number.parseInt(process.env.REDIS_PORT || '6379', 10) || 6379
const REDIS_USERNAME = process.env.REDIS_USERNAME
const REDIS_PASSWORD = process.env.REDIS_PASSWORD
const REDIS_TLS = process.env.REDIS_TLS === 'true'

let workers: BullWorker[] = []
let shuttingDown = false
let quotaCooldownPromise: Promise<void> | null = null

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const redisQuotaCooldownMs = readPositiveIntEnv(
  'REDIS_QUOTA_COOLDOWN_MS',
  DEFAULT_REDIS_QUOTA_COOLDOWN_MS,
)

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isRedisQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return REDIS_QUOTA_ERROR_PATTERN.test(message)
}

async function createWorkers() {
  const [
    { createImageWorker },
    { createVideoWorker },
    { createVoiceWorker },
    { createTextWorker },
  ] = await Promise.all([
    import('./image.worker'),
    import('./video.worker'),
    import('./voice.worker'),
    import('./text.worker'),
  ])

  return [createImageWorker(), createVideoWorker(), createVoiceWorker(), createTextWorker()]
}

async function closeWorkerWithTimeout(worker: BullWorker) {
  await Promise.race([
    worker.close(),
    sleep(WORKER_CLOSE_TIMEOUT_MS),
  ])
}

async function closeWorkers(reason: string) {
  const currentWorkers = workers
  workers = []
  await Promise.allSettled(currentWorkers.map(closeWorkerWithTimeout))
  _ulogInfo('[Workers] closed:', {
    reason,
    count: currentWorkers.length,
  })
  return currentWorkers.length
}

function disconnectQueueRedis() {
  void import('@/lib/redis')
    .then(({ queueRedis }) => {
      queueRedis.disconnect()
    })
    .catch((error: unknown) => {
      _ulogError('[Workers] failed to disconnect queue Redis', error)
    })
}

async function enterRedisQuotaCooldown(source: string, error: Error) {
  if (quotaCooldownPromise || shuttingDown) return

  quotaCooldownPromise = (async () => {
    _ulogError('[Workers] Redis quota exhausted; entering cooldown', {
      source,
      cooldownMs: redisQuotaCooldownMs,
      error: error.message,
    })
    const closedCount = await closeWorkers('redis_quota_exhausted')
    if (closedCount > 0) {
      disconnectQueueRedis()
    }
    await sleep(redisQuotaCooldownMs)

    _ulogInfo('[Workers] Redis quota cooldown elapsed; restarting process')
    process.exit(1)
  })().catch((cooldownError: unknown) => {
    quotaCooldownPromise = null
    _ulogError('[Workers] Redis quota cooldown failed', cooldownError)
  })

  await quotaCooldownPromise
}

function attachWorkerHandlers(worker: BullWorker) {
  worker.on('ready', () => {
    _ulogInfo(`[Workers] ready: ${worker.name}`)
  })

  worker.on('error', (err) => {
    if (isRedisQuotaError(err)) {
      void enterRedisQuotaCooldown(worker.name, err)
      return
    }
    _ulogError(`[Workers] error: ${worker.name}`, err.message)
  })

  worker.on('failed', (job, err) => {
    _ulogError(`[Workers] job failed: ${worker.name}`, {
      jobId: job?.id,
      taskId: job?.data?.taskId,
      taskType: job?.data?.type,
      error: err.message,
    })
  })
}

function handleFatalProcessError(source: string, error: unknown) {
  if (isRedisQuotaError(error)) {
    const quotaError = error instanceof Error ? error : new Error(String(error))
    void enterRedisQuotaCooldown(source, quotaError)
    return
  }

  _ulogError(`[Workers] fatal ${source}`, error)
  process.exit(1)
}

process.on('uncaughtException', (error) => {
  handleFatalProcessError('uncaughtException', error)
})

process.on('unhandledRejection', (reason) => {
  handleFatalProcessError('unhandledRejection', reason)
})

async function startWorkers() {
  workers = await createWorkers()
  _ulogInfo('[Workers] started:', {
    count: workers.length,
    redisQuotaCooldownMs,
  })
  for (const worker of workers) {
    attachWorkerHandlers(worker)
  }
}

async function assertRedisAvailableBeforeWorkers() {
  let probeError: unknown = null
  const probeRedis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    tls: REDIS_TLS ? {} : undefined,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    retryStrategy: () => null,
  })
  probeRedis.on('error', (error) => {
    probeError = error
  })

  try {
    await probeRedis.connect()
    await probeRedis.ping()
    if (isRedisQuotaError(probeError)) {
      const quotaError = probeError instanceof Error ? probeError : new Error(String(probeError))
      await enterRedisQuotaCooldown('startup_preflight', quotaError)
      return false
    }
    return true
  } catch (error) {
    const quotaSource = isRedisQuotaError(probeError) ? probeError : error
    if (isRedisQuotaError(quotaSource)) {
      const quotaError = quotaSource instanceof Error ? quotaSource : new Error(String(quotaSource))
      await enterRedisQuotaCooldown('startup_preflight', quotaError)
      return false
    }
    throw error
  } finally {
    probeRedis.disconnect()
  }
}

async function main() {
  try {
    const redisAvailable = await assertRedisAvailableBeforeWorkers()
    if (redisAvailable && !shuttingDown) {
      await startWorkers()
    }
  } catch (error) {
    handleFatalProcessError('startup', error)
  }
}

void main()

async function shutdown(signal: string) {
  shuttingDown = true
  _ulogInfo(`[Workers] shutdown signal: ${signal}`)
  await closeWorkers(signal)
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
