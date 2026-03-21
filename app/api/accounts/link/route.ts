import { NextResponse } from 'next/server';

/**
 * DEPRECATED — Unipile OAuth flow removed.
 * Use POST /api/accounts/connect with { li_at } instead.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'deprecated', message: 'Use POST /api/accounts/connect with your li_at cookie instead.' },
    { status: 410 }
  );
}