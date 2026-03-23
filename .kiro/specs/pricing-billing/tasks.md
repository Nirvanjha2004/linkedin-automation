# Implementation Plan: Pricing & Billing

## Overview

Implement Stripe-based subscription billing with free/paid plan entitlements, peak account tracking, webhook-driven status, and billing UI. Tasks are ordered so each step builds on the previous and nothing is left unintegrated.

## Tasks

- [x] 1. Database schema and TypeScript types
  - Create `supabase/migrations/003_billing.sql` with the `user_subscriptions` table (plan, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, current_accounts, peak_accounts, grace_period_ends_at, updated_at trigger)
  - Add RLS policies: users can read own row; service role has full access
  - Add `PlanType`, `SubscriptionStatus`, `UserSubscription`, `EntitlementError`, `BillingStatus` types to `types/index.ts`
  - _Requirements: 2.3, 2.4, 2.6, 5.1, 6.1_

- [x] 2. Billing constants and EntitlementGuard
  - [x] 2.1 Create `lib/billing/constants.ts` with FREE_PLAN_LIMITS, PAID_PLAN_PRICING, GRACE_PERIOD_DAYS
    - _Requirements: 1.1, 1.2, 1.3, 2.1_

  - [x] 2.2 Create `lib/billing/entitlement.ts` with `getSubscription`, `isEffectivelyPaid`, `checkCampaignCreate`, `checkLeadUpload`, `checkAccountConnect`, `updateAccountCounters`
    - `getSubscription` auto-creates a free row if none exists
    - `isEffectivelyPaid` returns true if status is active OR (past_due AND grace not expired)
    - Each check function returns `{ allowed: true }` or `{ allowed: false, reason, upgrade_required: true, estimated_monthly_cost }`
    - `updateAccountCounters(userId, +1)` increments current_accounts and updates peak = max(peak, current)
    - `updateAccountCounters(userId, -1)` decrements current_accounts only (peak unchanged)
    - _Requirements: 1.1–1.6, 2.3, 2.4, 5.2, 5.3, 8.1–8.4_

  - [ ]* 2.3 Write property tests for EntitlementGuard
    - **Property 1: Free campaign limit** — for any free user with campaign count >= 1, checkCampaignCreate returns allowed: false with upgrade_required: true
    - **Property 2: Free lead limit** — for any free user where existing + new leads > 50, checkLeadUpload returns allowed: false
    - **Property 3: Free account limit** — for any free user with current_accounts >= 1, checkAccountConnect returns allowed: false
    - **Property 4+5: Peak tracks maximum and never decreases** — for any sequence of updateAccountCounters calls, peak_accounts equals the historical max of current_accounts
    - **Property 7: Grace period allows automation** — for any past_due user with future grace_period_ends_at, isEffectivelyPaid returns true
    - **Property 8: Expired grace enforces free limits** — for any past_due user with past grace_period_ends_at, all check functions return allowed: false
    - **Property 11: Entitlement error shape** — for any failing check, result contains upgrade_required: true and non-empty reason string
    - **Validates: Requirements 1.1–1.6, 2.3, 2.4, 5.2, 5.3, 8.2**

- [ ] 3. Checkpoint — ensure entitlement logic is solid before wiring to routes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Billing API routes
  - [x] 4.1 Create `app/api/billing/status/route.ts` (GET)
    - Reads `user_subscriptions` for the authenticated user
    - Returns `BillingStatus`: plan, subscription_status, current_accounts, peak_accounts, estimated_next_invoice, grace_period_ends_at, current_period_end
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 4.2 Write property test for billing status API
    - **Property 6: Billing amount is peak-based** — for any peak_accounts value, estimated_next_invoice in response equals max(0, peak-1) * 10
    - **Property 12: Status response includes required fields** — for any subscription, response includes current_accounts, peak_accounts, estimated_next_invoice
    - **Validates: Requirements 2.1, 2.2, 7.1, 7.2, 7.3**

  - [x] 4.3 Create `app/api/billing/checkout/route.ts` (POST)
    - Creates or retrieves Stripe customer for the user (store stripe_customer_id in user_subscriptions)
    - Creates a Stripe Checkout Session with the extra-accounts price, success/cancel URLs
    - Returns `{ url }` for client redirect
    - _Requirements: 4.1_

  - [x] 4.4 Create `app/api/billing/portal/route.ts` (POST)
    - Creates a Stripe Customer Portal session for the authenticated user
    - Returns `{ url }` for client redirect
    - _Requirements: 4.1_

- [x] 5. Stripe webhook handler
  - [x] 5.1 Create `app/api/billing/webhook/route.ts` (POST)
    - Verify Stripe webhook signature using `STRIPE_WEBHOOK_SECRET`
    - Handle `checkout.session.completed`: set plan=paid, subscription_status=active, store stripe_subscription_id, current_period_start/end
    - Handle `customer.subscription.updated`: sync status and period dates
    - Handle `customer.subscription.deleted`: set subscription_status=canceled, plan=free
    - Handle `invoice.paid`: set subscription_status=active, reset peak_accounts=current_accounts (cycle reset)
    - Handle `invoice.payment_failed`: set subscription_status=past_due, set grace_period_ends_at=NOW()+3days
    - _Requirements: 4.2, 4.5, 5.1, 5.5, 6.1–6.5_

  - [ ]* 5.2 Write unit tests for webhook handler
    - Example: checkout.session.completed sets status to active
    - Example: invoice.payment_failed sets past_due and grace_period_ends_at ~3 days out
    - Example: invoice.paid resets peak_accounts to current_accounts
    - Example: subscription.deleted sets canceled and plan=free
    - Example: invalid signature returns 400
    - **Property 9: Webhook-only status mutation** — verify no non-webhook route can set subscription_status
    - **Property 10: Cycle reset sets peak to current** — for any invoice.paid event, after handler runs, peak_accounts equals current_accounts
    - **Validates: Requirements 4.2, 4.5, 5.1, 5.5, 6.1–6.5, 2.6**

- [x] 6. Wire EntitlementGuard into existing API routes
  - [x] 6.1 Update `app/api/campaigns/route.ts` POST handler
    - Call `checkCampaignCreate(userId)` before insert
    - If `!allowed`, return 403 with `{ error, reason, upgrade_required: true }`
    - _Requirements: 1.1, 1.4, 8.1, 8.2_

  - [x] 6.2 Update lead upload/add routes (CSV uploader API and any direct lead add route)
    - Call `checkLeadUpload(userId, newLeadCount)` before insert
    - If `!allowed`, return 403 with structured error
    - _Requirements: 1.2, 1.5, 8.1, 8.2_

  - [x] 6.3 Update `app/api/accounts/connect` route (or equivalent account creation route)
    - Call `checkAccountConnect(userId)` before creating account
    - If `!allowed`, return 403 with structured error
    - On success, call `updateAccountCounters(userId, +1)`
    - _Requirements: 1.3, 1.6, 2.3, 8.1, 8.2_

  - [x] 6.4 Update account delete/disconnect route
    - On success, call `updateAccountCounters(userId, -1)`
    - _Requirements: 2.4, 3.1_

- [ ] 7. Checkpoint — ensure all guards are wired and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Billing UI components
  - [x] 8.1 Create `components/billing/UpgradeModal.tsx`
    - Props: `open`, `onClose`, `reason`, `estimatedMonthlyCost`
    - Displays: "You have reached your free plan limits. Upgrade to continue. Estimated charge: $X/month."
    - "Upgrade" button calls POST /api/billing/checkout and redirects to returned URL
    - _Requirements: 7.4, 7.5_

  - [x] 8.2 Replace static `BillingSection` in `app/dashboard/settings/page.tsx`
    - Fetch live data from GET /api/billing/status on mount
    - Show current plan badge (free/paid/past_due)
    - Show current_accounts, peak_accounts this cycle, estimated next invoice
    - Show policy notice: "Billing is based on highest number of connected accounts during the billing period. Deleting accounts does not reduce charges already accrued in the current period."
    - Show "Manage billing" button (POST /api/billing/portal) for paid users
    - Show "Upgrade" button for free users
    - Show grace period warning banner if status is past_due
    - _Requirements: 3.3, 7.1, 7.2, 7.3_

  - [ ]* 8.3 Write example test for billing UI policy notice
    - Verify rendered BillingSection contains the required policy text string
    - **Validates: Requirements 3.3**

- [x] 9. Add Stripe dependency and environment variables
  - Install `stripe` npm package
  - Document required env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` (for extra account seat), `NEXT_PUBLIC_APP_URL`
  - _Requirements: 4.1, 6.1_

- [ ] 10. Final checkpoint — full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `user_subscriptions` row is auto-created with free defaults on first `getSubscription` call — no migration of existing users needed
- Stripe webhook must be registered in the Stripe dashboard pointing to `POST /api/billing/webhook`
- Peak accounts are tracked in our DB, not in Stripe — Stripe subscription quantity is updated to `max(0, peak-1)` at invoice time via the `invoice.upcoming` event or a pre-invoice job
