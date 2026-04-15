/**
 * cron-runner.mjs
 * Run alongside the Next.js dev server:  node scripts/cron-runner.mjs
 *
 * Schedule:
 *   - Scheduler  : every 3 minutes  → POST /api/scheduler-v2
 *   - Worker     : every 30 seconds → POST /api/worker
 *   - Msg Sync   : every 5 minutes  → POST /api/messages/sync
 */

import cron from 'node-cron';
import { config } from 'dotenv';

// Load .env / .env.local so NEXT_PUBLIC_APP_URL etc. are available
config({ path: '.env.local' });
config({ path: '.env' }); // fallback

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || '';

const headers = {
  'Content-Type': 'application/json',
  'x-cron-runner': '1',
  ...(CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {}),
};

async function callEndpoint(name, path) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers });
    const json = await res.json();
    const ts = new Date().toISOString();
    if (res.ok) {
      console.log(`[${ts}] ✅ ${name}:`, JSON.stringify(json));
    } else {
      console.error(`[${ts}] ❌ ${name} failed (${res.status}):`, JSON.stringify(json));
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ ${name} error:`, err.message);
  }
}

// ── Scheduler: every 3 minutes ──────────────────────────────────────────────
cron.schedule('*/3 * * * *', () => {
  callEndpoint('Scheduler', '/api/scheduler-v2');
});

// ── Worker: every 30 seconds (two jobs offset by 30s) ───────────────────────
cron.schedule('* * * * *', () => {
  callEndpoint('Worker', '/api/worker');
});

cron.schedule('* * * * *', () => {
  setTimeout(() => callEndpoint('Worker', '/api/worker'), 30_000);
});

// ── Connection acceptance checker: every 20 minutes ─────────────────────────
cron.schedule('*/2 * * * *', () => {
  callEndpoint('CheckConnections', '/api/check-connections');
});

// ── Message sync (hybrid mode): every 5 minutes ─────────────────────────────
cron.schedule('*/1 * * * *', () => {
  callEndpoint('MessageSync', '/api/messages/sync');
});

console.log(`🚀 Cron runner started — targeting ${BASE_URL}`);
console.log('   Scheduler        → /api/scheduler-v2      (every 3 min)');
console.log('   Worker           → /api/worker             (every 30 sec)');
console.log('   CheckConnections → /api/check-connections  (every 20 min)');
console.log('   MessageSync      → /api/messages/sync      (every 5 min)');
console.log('Press Ctrl+C to stop.\n');