import { Redis } from '@upstash/redis'

let client: Redis | null = null

export function getRedisClient(): Redis {
  if (!client) {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) {
      throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set')
    }
    client = new Redis({ url, token })
  }
  return client
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedisClient()
    const value = await redis.get<T>(key)
    return value ?? null
  } catch {
    return null
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    const redis = getRedisClient()
    await redis.set(key, value, { ex: ttlSeconds })
  } catch {
    // non-critical
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const redis = getRedisClient()
    await redis.del(key)
  } catch {
    // non-critical
  }
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  try {
    const redis = getRedisClient()
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  } catch {
    // non-critical
  }
}

