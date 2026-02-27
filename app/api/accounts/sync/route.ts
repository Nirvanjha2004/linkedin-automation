import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUnipileClient } from '@/lib/unipile/client';

// POST /api/accounts/sync
// Fetches all accounts from Unipile and upserts them into Supabase.
// Called after OAuth redirect with ?connected=true
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const unipile = getUnipileClient();
    const result = await unipile.listAccounts();

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Unipile returns { items: [...] } or array directly
    const rawAccounts = result.data?.items || result.data || [];
    const accounts = Array.isArray(rawAccounts) ? rawAccounts : [];

    if (accounts.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No accounts found in Unipile' });
    }

    // Only sync LinkedIn accounts (type === 'LINKEDIN' from Unipile response)
    const linkedinAccounts = accounts.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (acc: any) => !acc.type || acc.type === 'LINKEDIN'
    );

    let synced = 0;
    const errors: string[] = [];

    for (const acc of linkedinAccounts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = acc as any;

      // Unipile account id is in 'id' field
      const unipileAccountId = a.id;
      if (!unipileAccountId) {
        errors.push(`Skipped — no id. Keys: ${Object.keys(a).join(', ')}`);
        continue;
      }

      // Name from top-level 'name' or connection_params.im.username
      const name =
        a.name ||
        a.connection_params?.im?.username ||
        'LinkedIn Account';

      // Email not provided by Unipile in this response, leave null
      const email: string | null = a.email || null;

      // Active if any source has status 'OK'
      const isActive = Array.isArray(a.sources)
        ? a.sources.some((s: { status: string }) => s.status === 'OK')
        : true;

      const { error: upsertError } = await supabase
        .from('linkedin_accounts')
        .upsert(
          { user_id: user.id, unipile_account_id: unipileAccountId, name, email, is_active: isActive },
          { onConflict: 'unipile_account_id' }
        );

      if (upsertError) {
        errors.push(`Upsert failed for ${unipileAccountId}: ${upsertError.message}`);
      } else {
        synced++;
      }
    }

    return NextResponse.json({ synced, total: linkedinAccounts.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Account sync error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}