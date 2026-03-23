import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { bootstrapSession, getOwnProfile } from '@/lib/linkedin/client';
import { checkAccountConnect, updateAccountCounters } from '@/lib/billing/entitlement';

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

    // Entitlement check: enforce free plan account limit
    const entitlement = await checkAccountConnect(user.id);
    if (!entitlement.allowed) {
      return NextResponse.json(
        { error: entitlement.reason, reason: entitlement.reason, upgrade_required: true },
        { status: 403 }
      );
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

    // Step 3: Manual upsert (works even when ON CONFLICT constraint inference is unavailable)
    const payload = {
      user_id: user.id,
      name,
      // Keep legacy field populated for backward compatibility with older schema constraints.
      unipile_account_id: `linkedin:${profileUrn}`,
      li_at: liAt,
      jsessionid,
      profile_urn: profileUrn,
      vanity_name: vanityName,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: existingError } = await supabase
      .from('linkedin_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('profile_urn', profileUrn)
      .maybeSingle();

    if (existingError) {
      console.error('Database lookup error:', existingError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    let account = null;

    if (existing?.id) {
      const { data: updated, error: updateError } = await supabase
        .from('linkedin_accounts')
        .update(payload)
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) {
        console.error('Database update error:', updateError);
        return NextResponse.json({ error: 'Database error' }, { status: 500 });
      }

      account = updated;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('linkedin_accounts')
        .insert(payload)
        .select()
        .single();

      if (insertError) {
        console.error('Database insert error:', insertError);
        return NextResponse.json({ error: 'Database error' }, { status: 500 });
      }

      account = inserted;

      // New account connected — increment usage counters
      await updateAccountCounters(user.id, 1);
    }

    return NextResponse.json({ success: true, account });
  } catch (error) {
    console.error('Connect account error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}