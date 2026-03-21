import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { bootstrapSession, getOwnProfile } from '@/lib/linkedin/client';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const liAt: string | undefined = body?.li_at?.trim();

    if (!liAt) {
      return NextResponse.json({ error: 'li_at is required' }, { status: 400 });
    }

    // Step 1: Bootstrap JSESSIONID by hitting main LinkedIn page
    let jsessionid: string;
    try {
      jsessionid = await bootstrapSession(liAt);
    } catch (err: unknown) {
      return NextResponse.json(
        { error: 'invalid_token', message: (err as Error).message },
        { status: 422 }
      );
    }

    // Step 2: Fetch own profile using both cookies
    let profileUrn: string;
    let firstName: string;
    let lastName: string;
    let vanityName: string;
    try {
      ({ profileUrn, firstName, lastName, vanityName } = await getOwnProfile(liAt, jsessionid));
    } catch (err: unknown) {
      return NextResponse.json(
        { error: 'profile_fetch_failed', message: (err as Error).message },
        { status: 422 }
      );
    }

    const name = [firstName, lastName].filter(Boolean).join(' ') || vanityName;

    // Step 3: Upsert account
    const { data: account, error: upsertError } = await supabase
      .from('linkedin_accounts')
      .upsert({
        user_id: user.id,
        name,
        li_at: liAt,
        jsessionid,
        profile_urn: profileUrn,
        vanity_name: vanityName,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (upsertError) {
      console.error('Database upsert error:', upsertError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    return NextResponse.json({ success: true, account });
  } catch (error) {
    console.error('Connect account error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}