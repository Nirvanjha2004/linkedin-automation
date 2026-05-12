# LinkedIn Automation Platform

A production-grade LinkedIn outreach automation platform built with Next.js. Automate connection requests, follow-up sequences, and AI-powered lead qualification with meeting booking — all from a single dashboard.

---

## Features

### Campaign Management
- Create multi-step outreach campaigns with connection request notes, initial messages, and up to two follow-ups
- Personalize messages with dynamic placeholders: `{{first_name}}`, `{{last_name}}`, `{{company}}`, `{{title}}`
- Configure per-campaign daily limits, operational time windows, days of week, and timezone
- Campaign states: draft → active → paused → completed

### Lead Management
- Bulk import leads via CSV (LinkedIn URLs auto-enriched with name, company, title, headline, location, profile picture)
- Full lead lifecycle tracking: `pending → connection_sent → connected → message_sent → replied → followup_sent → completed/failed`
- Filter by status, campaign, or search by name/company
- Add notes and tags to individual leads

### Messaging & Conversations
- Sync LinkedIn conversations from all connected accounts
- Full conversation thread view with date separators and unread counts
- Rich text message editor (bold, italic, underline, lists, links)
- All messages persisted locally in Supabase with source metadata (`ui_send`, `worker_send`, `ai_agent`)

### AI Automation (Meeting Booking)
- Configurable AI persona and meeting objective
- Automatically detects interest signals in lead replies
- Proposes available Google Calendar slots and books confirmed meetings
- Booking stages: `qualifying → slot_proposal → slot_confirmation → done`
- User can pause, take over, or resume AI automation per conversation
- Full interaction logging for audit and debugging

### Account Management
- Connect multiple LinkedIn accounts via Unipile OAuth
- Track active/inactive account status
- Supports multiple accounts per user (paid feature)

### Billing & Subscriptions
- Free plan: 1 campaign, 50 leads, 1 LinkedIn account
- Paid plan: unlimited campaigns/leads, additional accounts at $10/account/month
- Stripe-powered checkout, customer portal, and webhook handling
- 3-day grace period on past-due subscriptions

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.1.6 (App Router) |
| UI | React 19, Tailwind CSS 4, Radix UI |
| Database | Supabase (PostgreSQL + Auth) |
| Cache / Queue | Upstash Redis + QStash |
| Payments | Stripe |
| LinkedIn | Unipile SDK + direct Voyager API |
| AI / LLM | Groq (`llama-3.3-70b-versatile`) |
| Calendar | Google Calendar API v3 (OAuth 2.0) |
| Forms | React Hook Form + Zod |
| Charts | Recharts |

---

## Architecture Overview

```
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
┌─────────────────┐  │  ┌────────────────────────────┐ │
│  Upstash Redis  │  │  │     AI Reply Jobs          │ │
│  (locks/cache)  │  │  │  (Groq + Google Calendar)  │ │
└─────────────────┘  │  └────────────────────────────┘ │
                     └─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│               External Integrations                 │
│   LinkedIn (Unipile + Voyager)  │  Stripe  │  Groq  │
└─────────────────────────────────────────────────────┘
```

### Background Job Flow

**Scheduler** (every 3 minutes via Vercel Cron):
1. Picks one action per account respecting operational windows and daily limits
2. Priority: connection requests → initial messages → follow-up 1 → follow-up 2
3. Atomically claims leads to prevent double-queuing

**Worker** (every 30 seconds via Vercel Cron):
1. Executes queued actions (connection requests, messages, follow-ups)
2. Enriches lead profiles from LinkedIn data
3. Retries with exponential backoff (up to 3 attempts)
4. Processes AI reply jobs with Redis-based distributed locking

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- An [Upstash](https://upstash.com) Redis database
- A [Stripe](https://stripe.com) account
- A [Groq](https://console.groq.com) API key
- A [Unipile](https://unipile.com) account (for LinkedIn OAuth)
- Google Cloud project with Calendar API enabled

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
NEXT_PUBLIC_APP_URL=http://localhost:3001

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

# Groq (LLM)
GROQ_API_KEY=gsk_...

# Google OAuth (Calendar)
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>

# Unipile (LinkedIn OAuth)
UNIPILE_DSN=<dsn>
UNIPILE_API_KEY=<api-key>

# Cron Security
CRON_SECRET=<random-secret>

# LinkedIn Voyager API (optional, for direct API)
LINKEDIN_MESSENGER_MESSAGES_QUERY_ID=<query-id>
LINKEDIN_PROFILE_QUERY_ID=<query-id>
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

To run the cron jobs locally:

```bash
npm run cron
```

---

## Project Structure

```
├── app/
│   ├── (auth)/              # Login & register pages
│   ├── api/                 # API route handlers
│   │   ├── accounts/        # LinkedIn account management
│   │   ├── ai-automation/   # AI config, Google Calendar OAuth, conversation control
│   │   ├── billing/         # Stripe checkout, portal, webhooks
│   │   ├── campaigns/       # Campaign CRUD
│   │   ├── leads/           # Lead CRUD + CSV upload
│   │   ├── messages/        # Conversations, send, sync
│   │   ├── scheduler-v2/    # Action scheduling cron endpoint
│   │   └── worker/          # Action execution cron endpoint
│   └── dashboard/           # Dashboard pages (campaigns, leads, messages, etc.)
│
├── components/
│   ├── billing/             # UpgradeModal
│   ├── campaigns/           # CampaignForm
│   ├── leads/               # LeadTable, LeadDrawer, CSVUploader
│   ├── messages/            # MessagesInbox
│   └── ui/                  # Shared UI primitives (badge, button, etc.)
│
├── lib/
│   ├── ai/                  # Conversation handler, prompt builder, slot parser
│   ├── billing/             # Plan constants, entitlement checks
│   ├── google/              # Google Calendar client
│   ├── linkedin/            # Voyager API client, message sync
│   ├── redis/               # Upstash client, distributed lock manager
│   ├── scheduler/           # Message personalizer, time window calculator
│   ├── supabase/            # Browser, server, and admin Supabase clients
│   └── unipile/             # Unipile SDK wrapper
```

---

## API Reference

### Campaigns
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/campaigns` | List all campaigns |
| POST | `/api/campaigns` | Create a campaign |
| GET | `/api/campaigns/[id]` | Get campaign details |
| PATCH | `/api/campaigns/[id]` | Update a campaign |

### Leads
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leads` | List leads (paginated, filterable) |
| POST | `/api/leads` | Create a lead |
| POST | `/api/leads/upload` | Bulk CSV upload |
| PATCH | `/api/leads/[id]` | Update lead (notes, tags) |
| DELETE | `/api/leads/[id]` | Delete a lead |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages/conversations` | List conversations |
| GET | `/api/messages/conversations/[id]` | Get conversation + messages |
| POST | `/api/messages/send` | Send a message |
| POST | `/api/messages/sync` | Sync messages from LinkedIn |

### Accounts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/accounts` | List connected LinkedIn accounts |
| POST | `/api/accounts/connect` | Initiate Unipile OAuth flow |
| POST | `/api/accounts/link` | Complete OAuth callback |
| POST | `/api/accounts/sync` | Sync account details |
| PATCH | `/api/accounts/[id]` | Update account |

### AI Automation
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai-automation/config` | Get AI config |
| PATCH | `/api/ai-automation/config` | Update AI config |
| GET | `/api/ai-automation/conversations/[id]/logs` | Get AI interaction logs |
| POST | `/api/ai-automation/conversations/[id]/toggle` | Enable/disable AI for conversation |
| POST | `/api/ai-automation/conversations/[id]/takeover` | User takes over conversation |
| POST | `/api/ai-automation/conversations/[id]/resume` | Resume AI automation |
| POST | `/api/ai-automation/google/connect` | Initiate Google Calendar OAuth |
| POST | `/api/ai-automation/google/callback` | Google Calendar OAuth callback |

### Billing
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/billing/status` | Get subscription status + estimated invoice |
| POST | `/api/billing/checkout` | Create Stripe checkout session |
| GET | `/api/billing/portal` | Redirect to Stripe customer portal |
| POST | `/api/billing/webhook` | Stripe webhook handler |

### Background Jobs (Cron)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/scheduler-v2` | Schedule next actions per account |
| POST | `/api/worker` | Execute queued actions |
| POST | `/api/check-connections` | Batch check for accepted connections |

All cron endpoints require the `Authorization: Bearer <CRON_SECRET>` header.

---

## Billing Plans

| Feature | Free | Paid |
|---------|------|------|
| Campaigns | 1 | Unlimited |
| Leads | 50 | Unlimited |
| LinkedIn Accounts | 1 | Multiple |
| AI Automation | ✓ | ✓ |
| Message Templates | ✓ | ✓ |
| Price | Free | $10/account/month |

Subscriptions are managed via Stripe. The first LinkedIn account is included; additional accounts are billed at $10/month each. Peak account count is tracked for billing purposes.

---

## Authentication

- **User auth**: Supabase Auth with Google OAuth
- **LinkedIn accounts**: OAuth via Unipile hosted auth flow
- **Google Calendar**: OAuth 2.0 with refresh token storage (access tokens are never persisted)
- **Row-Level Security**: All user data is filtered by `user_id` at the database level
- **Cron jobs**: Protected via `CRON_SECRET` header validation

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
6. Set up Google OAuth redirect URI to `https://<your-domain>/api/ai-automation/google/callback`

### Build

```bash
npm run build
npm run start
```

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run cron` | Run cron jobs locally |

---

## License

Private — all rights reserved.
