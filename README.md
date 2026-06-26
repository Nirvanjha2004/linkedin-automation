# OutreachIQ: LinkedIn Automation Platform

A production-grade LinkedIn outreach automation platform built with Next.js. Automate connection requests, follow-up sequences, and lead tracking from a single, unified dashboard.

---

## Architecture Overview & Decisions

The architecture of OutreachIQ is designed around reliability, scalability, and asynchronous background processing to adhere safely to LinkedIn's limits.

```text
┌─────────────────────────────────────────────────────┐
│                   Next.js App Router                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  Dashboard   │  │  API Routes  │  │  Auth     │ │
│  │  (React UI)  │  │  (handlers)  │  │ (Supabase)│ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌─────────────────────────────────┐
│   Supabase DB   │  │        Background Jobs          │
│  (PostgreSQL)   │  │  ┌────────────┐ ┌────────────┐  │
│  + RLS policies │  │  │ Scheduler  │ │   Worker   │  │
└─────────────────┘  │  │ (3 min)    │ │ (30 sec)   │  │
                     │  └────────────┘ └────────────┘  │
┌─────────────────┐  └─────────────────────────────────┘
│  Upstash Redis  │
│  (distributed   │
│   locking)      │
└─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│               External Integrations                 │
│         LinkedIn (Custom / Unipile)  │  Stripe      │
└─────────────────────────────────────────────────────┘
```

### 1. Next.js App Router (Full Stack Framework)
**Why?** Next.js App Router allows us to co-locate our React frontend with our backend API routes. This reduces infrastructure complexity since Vercel seamlessly provisions serverless functions for both. React Server Components and Server Actions reduce client-side Javascript, making the dashboard fast and SEO-friendly.

### 2. Supabase (PostgreSQL & Auth)
**Why?** 
- **Database:** PostgreSQL handles our complex relational data (`users` -> `campaigns` -> `leads` -> `action_queue`).
- **Action Queue:** We use a database-backed queue (`action_queue` table) instead of purely an in-memory queue like Redis. This ensures persistence, allows us to query pending items by scheduled execution time (`execute_at`), easily build UI dashboards for pending tasks, and implement multi-day exponential backoffs without memory bloat.
- **Security:** Row Level Security (RLS) is applied at the database layer. This ensures multi-tenant data isolation; even if there is a bug in the application logic, a user cannot query another user's campaigns or leads.

### 3. Asynchronous "Hybrid" Job Processing (Scheduler & Worker)
**Why?** LinkedIn has strict rate limits and unpredictable network delays. Long-running tasks easily exceed serverless function timeouts.
- **The Scheduler (`/api/scheduler-v2`):** Runs every 3 minutes. It evaluates active campaigns, checks operational time windows (e.g., 9 AM - 5 PM on weekdays), enforces daily connection limits, and calculates the exact timestamp for the next connection/message, injecting it into the `action_queue`.
- **The Worker (`/api/worker`):** Runs every 30-60 seconds. It only fetches rows from `action_queue` where `execute_at <= NOW()`. It executes the API call to LinkedIn. If it fails, it increments the retry count and pushes the `execute_at` into the future (exponential backoff). This decoupling ensures UI interactions remain instant.

### 4. Database Message Synchronization (`/api/messages/sync`)
**Why?** Querying LinkedIn's native messaging API in real time via the browser is slow, highly rate-limited, and doesn't allow cross-referencing with our campaign leads. 
Instead, a background task synchronizes inbound and outbound LinkedIn messages into our local `messages` and `conversations` tables. This ensures instant load times in our Inbox UI, and crucially, allows us to detect when a lead has replied so the scheduler can automatically pause automated follow-ups.

### 5. Upstash Redis & QStash
**Why?** We use Redis for highly available distributed locks. When the cron worker wakes up, multiple serverless instances could accidentally fire at once. Redis locks ensure that a specific lead or campaign is only processed by a single worker thread at a time, preventing embarrassing double-sends on LinkedIn.

### 6. Unipile & Custom LinkedIn Clients
**Why?** Managing direct headless browser sessions in a serverless environment is heavy and brittle. We interact with LinkedIn using a custom API wrapper (leveraging valid `li_at` / `jsessionid` cookies) and Unipile SDK integrations to manage session state securely and perform lightweight HTTP requests mimicking the native Voyager API.

---

## Core Features

### Campaign Management
- Create multi-step outreach campaigns with connection request notes, initial messages, and up to two follow-ups.
- Personalize messages with dynamic placeholders: `{{first_name}}`, `{{last_name}}`, `{{company}}`, `{{title}}`.
- Configure per-campaign daily limits, operational time windows, days of week, and timezone.
- Campaign states: draft → active → paused → completed.

### Lead Management
- Bulk import leads via CSV (LinkedIn URLs auto-enriched with name, company, title, headline, location, profile picture).
- Full lead lifecycle tracking: `pending → connection_sent → connected → message_sent → replied → followup_sent → completed/failed`.
- Filter by status, campaign, or search by name/company.
- Add notes and tags to individual leads.

### Messaging & Conversations
- Sync LinkedIn conversations from all connected accounts locally.
- Full conversation thread view with date separators and unread counts.
- Rich text message editor (bold, italic, underline, lists, links) inside the app.
- All messages persisted locally in Supabase with source metadata.

### Account Management
- Connect multiple LinkedIn accounts.
- Track active/inactive account status with automatic cookie refreshing handling.
- Supports multiple accounts per user (paid feature).

### Billing & Subscriptions
- Free plan: 1 campaign, 50 leads, 1 LinkedIn account.
- Paid plan: unlimited campaigns/leads, additional accounts at $10/account/month.
- Stripe-powered checkout, customer portal, and webhook handling.
- 3-day grace period on past-due subscriptions.

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- An [Upstash](https://upstash.com) Redis database
- A [Stripe](https://stripe.com) account
- A [Unipile](https://unipile.com) account (for LinkedIn OAuth)

### Installation

```bash
git clone <repo-url>
cd linkedin-automation
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://<db>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Unipile (LinkedIn Auth)
UNIPILE_DSN=<dsn>
UNIPILE_API_KEY=<api-key>

# Cron Security
CRON_SECRET=<random-secret>

# LinkedIn Voyager API (optional)
LINKEDIN_MESSENGER_MESSAGES_QUERY_ID=<query-id>
LINKEDIN_PROFILE_QUERY_ID=<query-id>
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

To run the cron jobs locally:

```bash
npm run cron
```

---

## Deployment

### Vercel (Recommended)

1. Push to GitHub and import the repo in [Vercel](https://vercel.com)
2. Add all environment variables in the Vercel project settings
3. Configure Vercel Cron Jobs in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/scheduler-v2", "schedule": "*/3 * * * *" },
    { "path": "/api/worker", "schedule": "*/1 * * * *" },
    { "path": "/api/check-connections", "schedule": "*/5 * * * *" }
  ]
}
```

4. Set up Stripe webhook pointing to `https://<your-domain>/api/billing/webhook`
5. Set up Unipile webhook/callback pointing to `https://<your-domain>/api/accounts/link`

---

## License

Private — all rights reserved.
