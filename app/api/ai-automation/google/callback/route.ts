import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET /api/ai-automation/google/callback
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (state !== user.id) {
      return NextResponse.json({ error: 'Invalid state parameter' }, { status: 400 });
    }

    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/ai-automation/google/callback`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      return NextResponse.json({ error: `Token exchange failed: ${errorData}` }, { status: 400 });
    }

    const tokens = await tokenResponse.json();

    if (!tokens.refresh_token) {
      return NextResponse.json({ error: 'No refresh token returned from Google' }, { status: 400 });
    }

    // Store refresh token using admin client to bypass RLS
    const adminClient = createAdminClient();
    const { error: upsertError } = await adminClient
      .from('ai_automation_config')
      .upsert(
        {
          user_id: user.id,
          gcal_refresh_token: tokens.refresh_token,
          gcal_token_error: false,
        },
        { onConflict: 'user_id' }
      );

    if (upsertError) throw upsertError;

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings`);
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
