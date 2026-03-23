export const FREE_PLAN_LIMITS = {
  MAX_CAMPAIGNS: 1,
  MAX_LEADS: 50,
  MAX_ACCOUNTS: 1,
} as const;

export const PAID_PLAN_PRICING = {
  PRICE_PER_EXTRA_ACCOUNT: 10, // USD per billing cycle
  BASE_ACCOUNTS_INCLUDED: 1,
} as const;

export const GRACE_PERIOD_DAYS = 3;
