import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUnipileClient } from '@/lib/unipile/client';

// GET /api/accounts - List LinkedIn accounts
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: accounts, error } = await supabase
      .from('linkedin_accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ accounts: accounts || [] });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/accounts - Create/sync a LinkedIn account manually
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { unipile_account_id, name } = body;

    if (!unipile_account_id || !name) {
      return NextResponse.json({ error: 'unipile_account_id and name are required' }, { status: 400 });
    }

    // Verify the account exists in Unipile
    const unipile = getUnipileClient();
    const accountInfo = await unipile.fetchAccountById(unipile_account_id);

    const { data: account, error } = await supabase
      .from('linkedin_accounts')
      .upsert({
        user_id: user.id,
        unipile_account_id,
        name,
        email: (accountInfo.data as Record<string, unknown>)?.email as string || null,
        profile_url: (accountInfo.data as Record<string, unknown>)?.linkedin_url as string || null,
        is_active: true,
      }, {
        onConflict: 'user_id,unipile_account_id',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ account }, { status: 201 });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
