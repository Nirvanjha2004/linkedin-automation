export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type LeadStatus = 'pending' | 'processing' | 'connection_sent' | 'connected' | 'message_sent' | 'followup_1_sent' | 'followup_2_sent' | 'replied' | 'completed' | 'failed' | 'skipped';
export type ActionType = 'connect' | 'message' | 'follow_up';
export type ActionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface User {
  id: string;
  email: string;
  full_name?: string;
  created_at: string;
}

export interface LinkedInAccount {
  id: string;
  user_id: string;
  unipile_account_id: string;
  name: string;
  email?: string;
  profile_url?: string;
  is_active: boolean;
  created_at: string;
}

export interface TimeWindow {
  start_time: string; // "09:00"
  end_time: string;   // "17:00"
}

export interface CampaignSchedule {
  time_windows: TimeWindow[];
  days_of_week: number[]; // 0=Sunday, 1=Monday, ... 6=Saturday
  timezone: string;       // e.g. "America/New_York"
}

export interface MessageTemplate {
  connection_request?: string;  // max 300 chars
  initial_message?: string;
  follow_up_1?: string;
  follow_up_2?: string;
  follow_up_delay_days?: number; // days between follow-ups
}

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  linkedin_account_id: string;
  schedule: CampaignSchedule;
  message_templates: MessageTemplate;
  priority: number;
  status: CampaignStatus;
  daily_limit: number;       // max actions per day
  total_limit?: number;       // max total actions
  actions_today: number;
  actions_total: number;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  campaign_id: string;
  linkedin_url: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  custom_fields?: Record<string, string>;
  status: LeadStatus;
  connection_sent_at?: string;
  connected_at?: string;
  message_sent_at?: string;
  follow_up_1_sent_at?: string;
  follow_up_2_sent_at?: string;
  last_action_at?: string;
  notes?: string;
  // Enriched from Unipile profile fetch
  provider_id?: string;
  profile_pic_url?: string;
  headline?: string;
  location?: string;
  public_profile_url?: string;
  enriched_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ActionQueueItem {
  id: string;
  campaign_id: string;
  lead_id: string;
  action_type: ActionType;
  scheduled_for: string;
  status: ActionStatus;
  retry_count: number;
  error_message?: string;
  executed_at?: string;
  created_at: string;
}

export interface CampaignStats {
  total_leads: number;
  pending: number;
  connection_sent: number;
  connected: number;
  message_sent: number;
  replied: number;
  completed: number;
  failed: number;
  connection_rate: number;
  reply_rate: number;
}

export interface DashboardStats {
  total_campaigns: number;
  active_campaigns: number;
  total_leads: number;
  connections_sent_today: number;
  messages_sent_today: number;
  reply_rate: number;
}

export interface CSVRow {
  linkedin_url?: string;
  linkedin_profile_url?: string;
  profile_url?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  name?: string;
  company?: string;
  company_name?: string;
  title?: string;
  job_title?: string;
  email?: string;
  phone?: string;
  [key: string]: string | undefined;
}

export interface AccountLock {
  campaign_id: string;
  locked_at: string;
  expires_at: string;
}

export interface ConflictResolution {
  winner_campaign_id: string;
  loser_campaign_ids: string[];
  reason: string;
}