import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUnipileClient } from '@/lib/unipile/client';

// POST /api/accounts/link - Get Unipile hosted auth URL to connect LinkedIn account
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const unipile = getUnipileClient();

    const result = await unipile.createHostedAuthLink({
      success_redirect_url: `${appUrl}/dashboard/accounts?connected=true`,
      failure_redirect_url: `${appUrl}/dashboard/accounts?error=true`,
      user_id: user.id,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to create auth link' }, { status: 500 });
    }

    const url = (result.data as Record<string, unknown>)?.url || (result.data as Record<string, unknown>)?.hosted_url;
    return NextResponse.json({ url });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
