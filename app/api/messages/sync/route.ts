import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { syncMessagesForUser } from '@/lib/linkedin/message-sync';
import { createAdminClient } from '@/lib/supabase/server';
import { isValidCronRequest, cronUnauthorized } from '@/lib/cron-auth';

// POST /api/messages/sync - manual sync endpoint (hybrid mode support)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const accountId = typeof body?.account_id === 'string' ? body.account_id : undefined;
    const hasLocalCronHeader = request.headers.get('x-cron-runner') === '1';
    const isLocalDev = process.env.NODE_ENV !== 'production';
    const allowLocalCronBypass = isLocalDev && hasLocalCronHeader;
    const isCronRequest = isValidCronRequest(request) || allowLocalCronBypass;

    // Cron mode: background sync for all active users/accounts
    if (isCronRequest) {
      const admin = createAdminClient();
      const { data: accounts, error: accountError } = await admin
        .from('linkedin_accounts')
        .select('id, user_id')
        .eq('is_active', true);

      if (accountError) throw accountError;

      const usersToSync = new Set<string>();
      for (const account of accounts ?? []) {
        if (accountId && account.id !== accountId) continue;
        if (account.user_id) usersToSync.add(account.user_id);
      }

      let syncedAccounts = 0;
      let newConversations = 0;
      let newMessages = 0;
      let readStatusChanges = 0;

      for (const userId of usersToSync) {
        const result = await syncMessagesForUser(admin as never, { userId, accountId });
        syncedAccounts += result.syncedAccounts;
        newConversations += result.newConversations;
        newMessages += result.newMessages;
        readStatusChanges += result.readStatusChanges;
      }

      return NextResponse.json({
        success: true,
        mode: 'cron',
        syncedUsers: usersToSync.size,
        syncedAccounts,
        newConversations,
        newMessages,
        readStatusChanges,
        syncedAt: new Date().toISOString(),
      });
    }

    // User mode: manual sync from the dashboard UI
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return cronUnauthorized();
    }

    const result = await syncMessagesForUser(supabase as never, { userId: user.id, accountId });

    return NextResponse.json({
      success: true,
      mode: 'manual',
      ...result,
      syncedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
