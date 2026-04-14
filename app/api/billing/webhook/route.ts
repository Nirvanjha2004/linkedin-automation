import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';
import { GRACE_PERIOD_DAYS } from '@/lib/billing/constants';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

// POST /api/billing/webhook
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: unknown) {
    const error = err as Error;
    console.warn('[webhook] Invalid signature:', error.message);
    return NextResponse.json({ error: `Webhook signature verification failed: ${error.message}` }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        if (!userId) break;

        // Retrieve the subscription to get period dates
        const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string);
        const item = stripeSub.items.data[0];

        await supabase
          .from('user_subscriptions')
          .update({
            plan: 'paid',
            subscription_status: 'active',
            stripe_subscription_id: stripeSub.id,
            current_period_start: item ? new Date(item.current_period_start * 1000).toISOString() : null,
            current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
            grace_period_ends_at: null,
          })
          .eq('user_id', userId);
        break;
      }

      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as Stripe.Subscription;
        const customerId = stripeSub.customer as string;
        const item = stripeSub.items.data[0];

        const { data: sub } = await supabase
          .from('user_subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (!sub) break;

        await supabase
          .from('user_subscriptions')
          .update({
            subscription_status: stripeSub.status as string,
            current_period_start: item ? new Date(item.current_period_start * 1000).toISOString() : null,
            current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
          })
          .eq('user_id', sub.user_id);

        // If subscription became inactive or canceled, pause all active AI conversations
        if (stripeSub.status === 'canceled' || stripeSub.status === 'incomplete_expired') {
          await supabase
            .from('conversations')
            .update({ ai_status: 'paused' })
            .eq('user_id', sub.user_id)
            .eq('ai_status', 'active');
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as Stripe.Subscription;
        const customerId = stripeSub.customer as string;

        const { data: sub } = await supabase
          .from('user_subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (!sub) break;

        await supabase
          .from('user_subscriptions')
          .update({
            subscription_status: 'canceled',
            plan: 'free',
            stripe_subscription_id: null,
            grace_period_ends_at: null,
          })
          .eq('user_id', sub.user_id);

        // Pause all active AI conversations for this user
        await supabase
          .from('conversations')
          .update({ ai_status: 'paused' })
          .eq('user_id', sub.user_id)
          .eq('ai_status', 'active');
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const { data: sub } = await supabase
          .from('user_subscriptions')
          .select('user_id, current_accounts')
          .eq('stripe_customer_id', customerId)
          .single();

        if (!sub) break;

        // Cycle reset: peak_accounts resets to current_accounts at cycle start
        await supabase
          .from('user_subscriptions')
          .update({
            subscription_status: 'active',
            peak_accounts: sub.current_accounts,
            grace_period_ends_at: null,
          })
          .eq('user_id', sub.user_id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const { data: sub } = await supabase
          .from('user_subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (!sub) break;

        const graceEnd = new Date();
        graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);

        await supabase
          .from('user_subscriptions')
          .update({
            subscription_status: 'past_due',
            grace_period_ends_at: graceEnd.toISOString(),
          })
          .eq('user_id', sub.user_id);
        break;
      }

      default:
        // Unhandled event type — ignore
        break;
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error('[webhook] Handler error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
