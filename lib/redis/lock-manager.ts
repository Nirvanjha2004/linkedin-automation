import { getRedisClient } from './client';
import { AccountLock } from '@/types';

const LOCK_PREFIX = 'linkedin_account_lock:';
const LOCK_TTL_SECONDS = 300; // 5 minutes
const RATE_LIMIT_PREFIX = 'linkedin_rate:';

/**
 * Acquires a distributed lock for a LinkedIn account.
 * Returns true if lock was acquired, false if account is already locked.
 */
export async function acquireAccountLock(
  accountId: string,
  campaignId: string,
  ttlSeconds: number = LOCK_TTL_SECONDS
): Promise<boolean> {
  const redis = getRedisClient();
  const lockKey = `${LOCK_PREFIX}${accountId}`;
  const lockValue: AccountLock = {
    campaign_id: campaignId,
    locked_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };

  // NX = only set if not exists (atomic)
  const result = await redis.set(lockKey, JSON.stringify(lockValue), {
    nx: true,
    ex: ttlSeconds,
  });

  return result === 'OK';
}

/**
 * Releases the lock for a LinkedIn account.
 * Only releases if the lock belongs to the specified campaign.
 */
export async function releaseAccountLock(
  accountId: string,
  campaignId: string
): Promise<boolean> {
  const redis = getRedisClient();
  const lockKey = `${LOCK_PREFIX}${accountId}`;

  const lockData = await redis.get<string>(lockKey);
  if (!lockData) return true; // Already released

  const lock: AccountLock = typeof lockData === 'string' 
    ? JSON.parse(lockData) 
    : lockData as unknown as AccountLock;
    
  if (lock.campaign_id !== campaignId) {
    return false; // Lock belongs to another campaign
  }

  await redis.del(lockKey);
  return true;
}

/**
 * Gets current lock holder for an account.
 */
export async function getAccountLock(accountId: string): Promise<AccountLock | null> {
  const redis = getRedisClient();
  const lockKey = `${LOCK_PREFIX}${accountId}`;
  const data = await redis.get<string>(lockKey);
  if (!data) return null;
  
  return typeof data === 'string' ? JSON.parse(data) : data as unknown as AccountLock;
}

/**
 * Checks and increments rate limit counter.
 * Returns true if within limit, false if rate limit exceeded.
 */
export async function checkRateLimit(
  accountId: string,
  limitType: 'hourly' | 'daily',
  maxCount: number
): Promise<boolean> {
  const redis = getRedisClient();
  const now = new Date();
  
  let windowKey: string;
  let ttlSeconds: number;

  if (limitType === 'hourly') {
    const hour = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
    windowKey = `${RATE_LIMIT_PREFIX}${accountId}:hourly:${hour}`;
    ttlSeconds = 3600;
  } else {
    const day = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
    windowKey = `${RATE_LIMIT_PREFIX}${accountId}:daily:${day}`;
    ttlSeconds = 86400;
  }

  const current = await redis.incr(windowKey);
  
  // Set expiry on first increment
  if (current === 1) {
    await redis.expire(windowKey, ttlSeconds);
  }

  return current <= maxCount;
}

/**
 * Gets current rate limit usage.
 */
export async function getRateLimitUsage(
  accountId: string
): Promise<{ hourly: number; daily: number }> {
  const redis = getRedisClient();
  const now = new Date();
  
  const hour = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
  const day = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
  
  const hourlyKey = `${RATE_LIMIT_PREFIX}${accountId}:hourly:${hour}`;
  const dailyKey = `${RATE_LIMIT_PREFIX}${accountId}:daily:${day}`;

  const [hourly, daily] = await Promise.all([
    redis.get<number>(hourlyKey),
    redis.get<number>(dailyKey),
  ]);

  return {
    hourly: hourly || 0,
    daily: daily || 0,
  };
}
