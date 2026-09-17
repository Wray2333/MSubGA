interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * 内存令牌桶。订阅出口是公开的，没这个的话一条泄露的链接能被拿去打满带宽。
 * 单进程够用；真要多实例部署得换成共享存储。
 */
export function allow(key: string, capacity = 30, refillPerMinute = 30): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };

  const elapsedMinutes = (now - bucket.updatedAt) / 60_000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedMinutes * refillPerMinute);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}

/** 定期清掉早就满桶的条目，别让这个 Map 无限长 */
setInterval(
  () => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [key, bucket] of buckets) {
      if (bucket.updatedAt < cutoff) buckets.delete(key);
    }
  },
  5 * 60_000,
).unref?.();
