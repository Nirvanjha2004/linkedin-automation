import { NextRequest, NextResponse } from 'next/server';

/**
 * Validates the CRON_SECRET from the Authorization header.
 *
 * Vercel Cron Jobs automatically send:
 *   Authorization: Bearer <CRON_SECRET>
 * where CRON_SECRET is set as a Vercel environment variable.
 *
 * Local dev (cron-runner.mjs) sends the same header format.
 *
 * If CRON_SECRET is not configured (e.g. during initial local setup),
 * the check is bypassed so dev still works without configuring secrets.
 */
export function isValidCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  // No secret configured — allow through (local dev convenience)
  if (!secret) return true;

  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

/** Returns a standardized 401 response for unauthorized cron calls */
export function cronUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}