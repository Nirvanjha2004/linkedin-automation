import { NextResponse } from 'next/server';

/**
 * DEPRECATED — Unipile account sync removed.
 * Accounts are now connected directly via POST /api/accounts/connect with { li_at }.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'deprecated', message: 'Use POST /api/accounts/connect with your li_at cookie instead.' },
    { status: 410 }
  );
}