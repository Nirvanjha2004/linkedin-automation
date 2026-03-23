# Requirements Document

## Introduction

A pricing and billing system for a LinkedIn outreach SaaS application. The system enforces plan-based entitlements (free vs. paid), tracks peak account usage per billing cycle to prevent abuse, integrates with Stripe for subscription management, and uses webhooks as the source of truth for subscription status.

## Glossary

- **Free_Plan**: The default plan with limits of 1 campaign, 50 leads, and 1 LinkedIn account.
- **Paid_Plan**: A subscription plan at $10 per extra LinkedIn account per billing period.
- **Extra_Account**: Any LinkedIn account beyond the first one included in the base plan.
- **Peak_Accounts**: The highest number of connected LinkedIn accounts during a billing cycle.
- **Current_Accounts**: The number of LinkedIn accounts connected at any given moment.
- **Billing_Cycle**: The period between subscription renewal dates.
- **Entitlement_Guard**: A server-side check that enforces plan limits before allowing an action.
- **Grace_Period**: A 3-day window after payment failure during which existing automation continues.
- **Subscription_Status**: The current state of a user's subscription as set by Stripe webhooks (active, past_due, canceled).
- **Upgrade_Modal**: A UI component shown when a user attempts a gated action without the required plan.
- **Checkout_Session**: A Stripe-hosted payment flow initiated when a user upgrades.

## Requirements

### Requirement 1: Free Plan Entitlements

**User Story:** As a free user, I want to use the product within defined limits, so that I can evaluate the service before committing to a paid plan.

#### Acceptance Criteria

1. WHILE a user is on the Free_Plan, THE Entitlement_Guard SHALL allow a maximum of 1 campaign to exist at any time.
2. WHILE a user is on the Free_Plan, THE Entitlement_Guard SHALL allow a maximum of 50 leads total across all campaigns.
3. WHILE a user is on the Free_Plan, THE Entitlement_Guard SHALL allow a maximum of 1 connected LinkedIn account.
4. WHEN a free user attempts to create a second campaign, THE Entitlement_Guard SHALL block the action and trigger the Upgrade_Modal.
5. WHEN a free user attempts to add leads that would cause total leads to exceed 50, THE Entitlement_Guard SHALL block the action and trigger the Upgrade_Modal.
6. WHEN a free user attempts to connect a second LinkedIn account, THE Entitlement_Guard SHALL block the action and trigger the Upgrade_Modal.

### Requirement 2: Paid Plan Pricing

**User Story:** As a paid user, I want to be billed fairly based on my actual peak usage, so that I understand exactly what I am paying for.

#### Acceptance Criteria

1. THE Billing_System SHALL charge $10 per Extra_Account per Billing_Cycle.
2. THE Billing_System SHALL compute billable extra accounts as max(0, Peak_Accounts - 1) for each Billing_Cycle.
3. WHEN a paid user connects a LinkedIn account, THE Billing_System SHALL update Current_Accounts and set Peak_Accounts to max(Peak_Accounts, Current_Accounts).
4. WHEN a paid user disconnects a LinkedIn account, THE Billing_System SHALL decrement Current_Accounts but SHALL NOT reduce Peak_Accounts for the current Billing_Cycle.
5. THE Billing_System SHALL invoice based on Peak_Accounts at the end of each Billing_Cycle.
6. WHEN a new Billing_Cycle starts, THE Billing_System SHALL reset Peak_Accounts to the value of Current_Accounts at cycle start.

### Requirement 3: Peak Account Abuse Prevention

**User Story:** As a business owner, I want to prevent users from adding and deleting accounts to avoid billing, so that revenue is protected.

#### Acceptance Criteria

1. WHEN a user adds accounts and then deletes them within the same Billing_Cycle, THE Billing_System SHALL retain the Peak_Accounts value from the highest point in that cycle.
2. THE Billing_System SHALL bill for all Extra_Accounts that were connected at any point during the Billing_Cycle, regardless of whether they are still connected at invoice time.
3. THE Billing_System SHALL display a policy notice stating: "Billing is based on highest number of connected accounts during the billing period. Deleting accounts does not reduce charges already accrued in the current period."

### Requirement 4: Subscription Lifecycle

**User Story:** As a user upgrading to paid, I want a smooth checkout experience, so that I can start using paid features immediately after payment.

#### Acceptance Criteria

1. WHEN a user initiates an upgrade, THE Billing_System SHALL create a Stripe customer and initiate a Checkout_Session.
2. WHEN a Checkout_Session completes successfully, THE Billing_System SHALL activate the subscription and set Subscription_Status to active via webhook.
3. WHEN a Billing_Cycle ends, THE Billing_System SHALL generate an invoice based on Peak_Accounts for that cycle.
4. WHEN a new Billing_Cycle begins, THE Billing_System SHALL reset Peak_Accounts to Current_Accounts.
5. WHEN a subscription is canceled, THE Billing_System SHALL set Subscription_Status to canceled via webhook and enforce Free_Plan limits.

### Requirement 5: Payment Failure and Grace Period

**User Story:** As a paid user experiencing a payment failure, I want a grace period before my access is restricted, so that I have time to resolve the issue without losing active campaigns.

#### Acceptance Criteria

1. WHEN an invoice payment fails, THE Billing_System SHALL set Subscription_Status to past_due and begin a 3-day Grace_Period.
2. WHILE a user is within the Grace_Period, THE Entitlement_Guard SHALL allow existing automation to continue running.
3. WHEN the Grace_Period expires without payment resolution, THE Entitlement_Guard SHALL block new campaign creation, lead imports, and extra account connections.
4. IF the Grace_Period expires, THEN THE Billing_System SHALL preserve all existing user data without deletion.
5. WHEN a failed invoice is paid during or after the Grace_Period, THE Billing_System SHALL restore Subscription_Status to active via webhook.

### Requirement 6: Webhook-Driven Subscription Status

**User Story:** As a system operator, I want subscription status to be driven by Stripe webhooks, so that the application state is always consistent with the payment processor.

#### Acceptance Criteria

1. THE Billing_System SHALL update Subscription_Status in the database only upon receiving verified Stripe webhook events.
2. WHEN a webhook event of type subscription.active is received, THE Billing_System SHALL set Subscription_Status to active.
3. WHEN a webhook event of type invoice.payment_failed is received, THE Billing_System SHALL set Subscription_Status to past_due.
4. WHEN a webhook event of type subscription.canceled is received, THE Billing_System SHALL set Subscription_Status to canceled.
5. WHEN a webhook event of type invoice.paid is received, THE Billing_System SHALL set Subscription_Status to active and record the payment.
6. THE Entitlement_Guard SHALL read Subscription_Status exclusively from the database record set by webhooks, not from client-side state.

### Requirement 7: Billing UI Indicators

**User Story:** As a paid user, I want to see my current usage and estimated charges in the dashboard, so that I can make informed decisions about my account connections.

#### Acceptance Criteria

1. THE Billing_Dashboard SHALL display Current_Accounts for the user.
2. THE Billing_Dashboard SHALL display Peak_Accounts for the current Billing_Cycle.
3. THE Billing_Dashboard SHALL display the estimated next invoice amount based on current Peak_Accounts.
4. WHEN a user hits a gated action, THE Upgrade_Modal SHALL display the estimated monthly charge based on the action being attempted.
5. THE Upgrade_Modal SHALL display a message in the format: "You have reached your free plan limits. Upgrade to continue. Estimated charge: $X/month."

### Requirement 8: Entitlement Guard API Layer

**User Story:** As a developer, I want all entitlement checks to happen server-side, so that plan limits cannot be bypassed by client-side manipulation.

#### Acceptance Criteria

1. THE Entitlement_Guard SHALL perform all plan limit checks on the server before executing any gated action.
2. WHEN an entitlement check fails, THE Entitlement_Guard SHALL return a structured error response with an upgrade_required flag and the reason for the block.
3. THE Entitlement_Guard SHALL check Subscription_Status from the database on every gated API request.
4. WHEN a user's Subscription_Status is past_due and Grace_Period has expired, THE Entitlement_Guard SHALL treat the user as Free_Plan for new action checks.
