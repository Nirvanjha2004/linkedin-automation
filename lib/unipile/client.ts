import { UnipileClient as UnipileSDKClient } from 'unipile-node-sdk';

// ─── Standardized Error Codes ─────────────────────────────────────────────────

/**
 * Canonical error codes returned by every UnipileClient method.
 * Workers and schedulers should switch on these — never on raw strings.
 */
export type UnipileErrorCode =
  | 'already_invited'       // Invitation already pending or sent recently
  | 'already_connected'     // Lead is already a 1st-degree connection
  | 'account_disconnected'  // Account disconnected, in CAPTCHA checkpoint, or LinkedIn-restricted
  | 'rate_limited'          // 429 or weekly LinkedIn invitation cap reached
  | 'note_too_long'         // Connection note > 300 chars (LinkedIn hard limit)
  | 'not_connected'         // Cannot message: lead is not yet a 1st-degree connection
  | 'network_error'         // Cloudflare / proxy timeout — received HTML instead of JSON
  | 'unknown_error';        // Unclassified — see `message` field for details

// ─── Parsed Error Shape ────────────────────────────────────────────────────────

interface ParsedUnipileError {
  code: UnipileErrorCode;
  /** Human-readable, safe to store in the database */
  message: string;
  /** HTTP status if recoverable from the error object */
  httpStatus: number | null;
  /** Raw Unipile error type string (e.g. "errors/already_invited_recently") */
  rawType: string | null;
}

// ─── Public Interfaces ────────────────────────────────────────────────────────

interface UnipileConnectionRequest {
  account_id: string;
  linkedin_url: string;
  /** Optional personalised note — LinkedIn enforces a 300-char hard limit */
  message?: string;
}

interface UnipileMessage {
  account_id: string;
  linkedin_url: string;
  message: string;
  /**
   * If provided (stored in DB from sendConnectionRequest), skips the
   * getProfile API call entirely — saves one round-trip per message action.
   */
  provider_id?: string;
}

/** Enriched lead data extracted from a Unipile profile response */
export interface LeadProfileData {
  provider_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  profile_pic_url: string | null;
  public_profile_url: string | null;
  company: string | null;
  title: string | null;
}

export interface UnipileResponse {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  /** Standardized error code — use this in worker switch statements */
  error?: UnipileErrorCode | string;
  /** Human-readable detail for logs / DB storage */
  message?: string;
  /** True when LinkedIn reports the lead was already invited recently */
  alreadyInvited?: boolean;
  /** True when the lead is already a 1st-degree connection */
  alreadyConnected?: boolean;
  /** Enriched profile data fetched during the request — persist to DB */
  profileData?: LeadProfileData;
}

// ─── Helper: Extract LinkedIn Identifier ──────────────────────────────────────

/**
 * Extracts the bare public identifier from a LinkedIn profile URL.
 *
 *   "https://www.linkedin.com/in/nirvan-jha/"  →  "nirvan-jha"
 *   "https://linkedin.com/in/john-doe?trk=..." →  "john-doe"
 *   "nirvan-jha"                                →  "nirvan-jha"  (pass-through)
 *
 * Unipile's getProfile endpoint rejects full URLs — it requires just the handle.
 * This is applied to every call that accepts a linkedin_url or identifier.
 */
export function extractLinkedInIdentifier(url: string): string {
  if (!url) return url;

  // Match /in/<identifier> — stop at slash, query param, hash, or whitespace
  const match = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (match && match[1]) {
    // Strip any trailing slash that may have been captured
    return match[1].replace(/\/$/, '');
  }

  // Not a URL — treat as a raw identifier already
  return url.trim();
}

// ─── Helper: Parse Unipile Error ──────────────────────────────────────────────

/**
 * Deeply extracts a structured error from anything Unipile or LinkedIn can throw.
 *
 * Error sources handled:
 *   1. error.body.type / error.body.message   — Unipile SDK structured errors
 *   2. error.response.data.type / .message    — Raw HTTP response body fallback
 *   3. error.status / error.statusCode        — HTTP status code
 *   4. error.message                          — Standard JS Error fallback
 *
 * Special handling:
 *   - HTML payloads (Cloudflare 525 / nginx 500 proxy timeouts) are detected
 *     and truncated to a clean one-liner to prevent database log bloat.
 */
export function parseUnipileError(error: unknown): ParsedUnipileError {
  let rawType: string | null = null;
  let rawMessage: string | null = null;
  let httpStatus: number | null = null;

  if (error !== null && typeof error === 'object') {
    const e = error as Record<string, unknown>;

    // ── HTTP status ────────────────────────────────────────────────────────
    if (typeof e.status === 'number') httpStatus = e.status;
    else if (typeof e.statusCode === 'number') httpStatus = e.statusCode;

    // ── Unipile SDK structured body: { type, message } ────────────────────
    if (e.body !== null && typeof e.body === 'object') {
      const body = e.body as Record<string, unknown>;
      if (typeof body.type === 'string') rawType = body.type;
      if (typeof body.message === 'string') rawMessage = body.message;
    }

    // ── Raw HTTP response data (fallback when SDK doesn't parse body) ──────
    if (!rawType && e.response !== null && typeof e.response === 'object') {
      const res = e.response as Record<string, unknown>;

      if (typeof res.status === 'number' && httpStatus === null) {
        httpStatus = res.status;
      }

      if (res.data !== null && typeof res.data === 'object') {
        const data = res.data as Record<string, unknown>;
        if (typeof data.type === 'string') rawType = data.type;
        if (typeof data.message === 'string') rawMessage = data.message;
      } else if (typeof res.data === 'string') {
        // The response body itself might be a raw string (e.g. HTML)
        rawMessage = res.data;
      }
    }

    // ── Standard JS Error.message fallback ────────────────────────────────
    if (!rawMessage && typeof e.message === 'string') {
      rawMessage = e.message;
    }
  } else if (typeof error === 'string') {
    rawMessage = error;
  }

  // ── Detect Cloudflare / proxy HTML payload ────────────────────────────────
  // A 525 SSL handshake failure or 500 gateway error often returns a full HTML
  // document. Storing that in the DB wastes space and obscures real errors.
  if (
    rawMessage &&
    (rawMessage.trimStart().startsWith('<!DOCTYPE') ||
      rawMessage.trimStart().toLowerCase().startsWith('<html'))
  ) {
    return {
      code: 'network_error',
      message: 'Network error: Received HTML payload instead of JSON (Cloudflare/proxy timeout)',
      httpStatus,
      rawType,
    };
  }

  // ── Classify by rawType first, then fall through to httpStatus ────────────

  // Account disconnected / CAPTCHA checkpoint / LinkedIn restriction
  if (
    rawType === 'errors/disconnected_account' ||
    rawType === 'errors/checkpoint_error' ||
    rawType === 'errors/account_restricted' ||
    httpStatus === 401 ||
    httpStatus === 403
  ) {
    return {
      code: 'account_disconnected',
      message: rawMessage ?? `Account disconnected or restricted (${rawType ?? httpStatus})`,
      httpStatus,
      rawType,
    };
  }

  // Invitation already pending or sent too recently to resend
  if (
    rawType === 'errors/already_invited_recently' ||
    rawType === 'errors/cannot_resend_yet'
  ) {
    return {
      code: 'already_invited',
      message: rawMessage ?? 'Invitation already pending or recently sent',
      httpStatus,
      rawType,
    };
  }

  // Rate limited — 429 hard limit or LinkedIn's rolling weekly invitation cap
  if (
    httpStatus === 429 ||
    rawType === 'errors/rate_limited' ||
    rawMessage?.toLowerCase().includes('too many requests') ||
    rawMessage?.toLowerCase().includes('weekly invitation limit')
  ) {
    return {
      code: 'rate_limited',
      message: rawMessage ?? 'Rate limit reached',
      httpStatus,
      rawType,
    };
  }

  // Connection note exceeds LinkedIn's 300-character hard limit
  if (
    rawType === 'errors/too_many_characters' ||
    (httpStatus === 400 && rawMessage?.toLowerCase().includes('characters'))
  ) {
    return {
      code: 'note_too_long',
      message: rawMessage ?? 'Connection note exceeds the 300-character LinkedIn limit',
      httpStatus,
      rawType,
    };
  }

  // Cannot message — lead is not yet a 1st-degree connection
  if (
    rawType === 'errors/unprocessable_entity' ||
    rawMessage?.toLowerCase().includes('recipient cannot be reached') ||
    rawMessage?.toLowerCase().includes('cannot be reached')
  ) {
    return {
      code: 'not_connected',
      message: rawMessage ?? 'Recipient cannot be reached — not a 1st-degree connection',
      httpStatus,
      rawType,
    };
  }

  // Unclassified fallback
  return {
    code: 'unknown_error',
    message: rawMessage ?? 'An unknown Unipile error occurred',
    httpStatus,
    rawType,
  };
}

// ─── Profile Extractor ────────────────────────────────────────────────────────

/** Maps a raw Unipile UserProfile response to our LeadProfileData shape */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLeadProfile(profile: any): LeadProfileData {
  const firstName = profile?.first_name ?? null;
  const lastName = profile?.last_name ?? null;
  const fullName =
    firstName || lastName
      ? [firstName, lastName].filter(Boolean).join(' ')
      : null;

  // Current employer = first work_experience entry flagged as current
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentJob =
    (profile?.work_experience ?? []).find((w: any) => w.current) ??
    profile?.work_experience?.[0] ??
    null;

  return {
    provider_id: profile?.provider_id ?? null,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    headline: profile?.headline ?? null,
    location: profile?.location ?? null,
    profile_pic_url: profile?.profile_picture_url ?? null,
    public_profile_url: profile?.public_profile_url ?? null,
    company: currentJob?.company ?? null,
    title: currentJob?.position ?? null,
  };
}

// ─── Client Class ─────────────────────────────────────────────────────────────

class UnipileClient {
  private sdk: UnipileSDKClient;
  private baseUrl: string;

  constructor() {
    const dsn = process.env.UNIPILE_DSN!;
    const apiKey = process.env.UNIPILE_API_KEY!;

    // DSN may be supplied as a full URL or just the subdomain
    this.baseUrl = dsn.startsWith('https://')
      ? dsn
      : `https://${dsn}.unipile.com:13465`;

    this.sdk = new UnipileSDKClient(this.baseUrl, apiKey);
  }

  // ── sendConnectionRequest ─────────────────────────────────────────────────

  /**
   * Sends a LinkedIn connection request to a lead profile.
   *
   * Flow:
   *   1. Strip the URL to a bare identifier (Unipile rejects full URLs)
   *   2. Fetch profile — resolves provider_id and enriches lead data in one call
   *   3. Pre-flight checks: already connected / invitation already pending
   *   4. Client-side note length guard (300-char LinkedIn limit)
   *   5. Send invitation — catch all Unipile / LinkedIn edge cases
   *
   * All error paths return a clean { success: false, error: UnipileErrorCode }
   * object — never throw — so workers can switch on `result.error` directly.
   */
  async sendConnectionRequest(
    params: UnipileConnectionRequest
  ): Promise<UnipileResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let profile: any = null;

    // Always pass the bare identifier — Unipile rejects full LinkedIn URLs
    const identifier = extractLinkedInIdentifier(params.linkedin_url);

    // ── Step 1: Resolve profile ──────────────────────────────────────────────
    try {
      profile = await this.sdk.users.getProfile({
        account_id: params.account_id,
        identifier,
      });
    } catch (error: unknown) {
      const parsed = parseUnipileError(error);
      console.error(
        `[Unipile] getProfile failed for "${identifier}":`,
        parsed.message
      );
      return { success: false, error: parsed.code, message: parsed.message };
    }

    const providerId: string | null = profile?.provider_id ?? null;
    if (!providerId) {
      return {
        success: false,
        error: 'unknown_error',
        message: `Could not resolve provider_id from profile for identifier "${identifier}"`,
      };
    }

    const profileData = extractLeadProfile(profile);

    // ── Pre-check 1: already a 1st-degree connection ─────────────────────────
    if (profile?.network_distance === 'FIRST_DEGREE') {
      return {
        success: false,
        alreadyConnected: true,
        error: 'already_connected',
        message: 'Lead is already a 1st-degree connection',
        profileData,
      };
    }

    // ── Pre-check 2: invitation already pending ───────────────────────────────
    if (
      profile?.invitation?.type === 'SENT' &&
      profile?.invitation?.status === 'PENDING'
    ) {
      return {
        success: false,
        alreadyInvited: true,
        error: 'already_invited',
        message: 'Invitation already pending',
        profileData,
      };
    }

    // ── Client-side guard: LinkedIn 300-char note limit ───────────────────────
    if (params.message && params.message.length > 300) {
      return {
        success: false,
        error: 'note_too_long',
        message: `Connection note is ${params.message.length} chars — LinkedIn enforces a 300-char maximum`,
        profileData,
      };
    }

    // ── Step 2: Send invitation ───────────────────────────────────────────────
    try {
      const invitePayload: {
        account_id: string;
        provider_id: string;
        message?: string;
      } = { account_id: params.account_id, provider_id: providerId };

      if (params.message) invitePayload.message = params.message;

      const response = await this.sdk.users.sendInvitation(invitePayload);
      return { success: true, data: response, profileData };
    } catch (error: unknown) {
      const parsed = parseUnipileError(error);
      console.error(
        `[Unipile] sendInvitation failed for provider_id "${providerId}":`,
        parsed.message
      );

      // Bubble up flags that workers act on specially
      if (parsed.code === 'already_invited') {
        return {
          success: false,
          alreadyInvited: true,
          error: parsed.code,
          message: parsed.message,
          profileData,
        };
      }
      if (parsed.code === 'already_connected') {
        return {
          success: false,
          alreadyConnected: true,
          error: parsed.code,
          message: parsed.message,
          profileData,
        };
      }

      return {
        success: false,
        error: parsed.code,
        message: parsed.message,
        profileData,
      };
    }
  }

  // ── sendMessage ──────────────────────────────────────────────────────────────

  /**
   * Sends a direct LinkedIn message via startNewChat.
   *
   * Optimisation: if `provider_id` is already stored in the DB (set during
   * sendConnectionRequest), the getProfile round-trip is skipped entirely.
   *
   * Key error: `not_connected` — startNewChat will fail with 422 if the lead
   * has not yet accepted the connection request. Workers should re-queue or
   * pause on this code rather than marking the lead as failed.
   */
  async sendMessage(params: UnipileMessage): Promise<UnipileResponse> {
    let providerId = params.provider_id ?? null;

    // ── Resolve provider_id only if not already stored ────────────────────────
    if (!providerId) {
      const identifier = extractLinkedInIdentifier(params.linkedin_url);
      try {
        const profile = await this.sdk.users.getProfile({
          account_id: params.account_id,
          identifier,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerId = (profile as any)?.provider_id ?? null;
      } catch (error: unknown) {
        const parsed = parseUnipileError(error);
        console.error(
          `[Unipile] getProfile failed in sendMessage for "${params.linkedin_url}":`,
          parsed.message
        );
        return { success: false, error: parsed.code, message: parsed.message };
      }
    }

    if (!providerId) {
      return {
        success: false,
        error: 'unknown_error',
        message: 'Could not resolve provider_id for messaging',
      };
    }

    // ── Send message ──────────────────────────────────────────────────────────
    try {
      const response = await this.sdk.messaging.startNewChat({
        account_id: params.account_id,
        attendees_ids: [providerId],
        text: params.message,
      });
      return { success: true, data: response };
    } catch (error: unknown) {
      const parsed = parseUnipileError(error);
      console.error(
        `[Unipile] startNewChat failed for provider_id "${providerId}":`,
        parsed.message
      );
      // `not_connected` is the most actionable code here — worker should
      // re-queue rather than marking lead as permanently failed
      return { success: false, error: parsed.code, message: parsed.message };
    }
  }

  // ── getAllRelations ────────────────────────────────────────────────────────

  /**
   * Fetches up to 100 accepted 1st-degree connections for an account.
   * Used by check-connections to batch-detect accepted invitations.
   */
  async getAllRelations(unipileAccountId: string): Promise<UnipileResponse> {
    try {
      const response = await this.sdk.users.getAllRelations({
        account_id: unipileAccountId,
        limit: 100,
      });
      return { success: true, data: response };
    } catch (error: unknown) {
      const parsed = parseUnipileError(error);
      console.error(`[Unipile] getAllRelations failed:`, parsed.message);
      return { success: false, error: parsed.code, message: parsed.message };
    }
  }

  // ── getProfile ────────────────────────────────────────────────────────────

  /**
   * Fetches a LinkedIn profile by URL or raw identifier.
   * Automatically strips full URLs to bare identifiers before the API call.
   */
  async getProfile(
    unipileAccountId: string,
    identifier: string
  ): Promise<UnipileResponse> {
    const cleanIdentifier = extractLinkedInIdentifier(identifier);
    try {
      const response = await this.sdk.users.getProfile({
        account_id: unipileAccountId,
        identifier: cleanIdentifier,
      });
      return { success: true, data: response };
    } catch (error: unknown) {
      const parsed = parseUnipileError(error);
      console.error(
        `[Unipile] getProfile failed for "${cleanIdentifier}":`,
        parsed.message
      );
      return { success: false, error: parsed.code, message: parsed.message };
    }
  }

  // ── listAccounts ──────────────────────────────────────────────────────────

  /** Lists all connected accounts via Unipile. */
  async listAccounts(): Promise<UnipileResponse> {
    try {
      const response = await this.sdk.account.getAll({});
      return { success: true, data: response };
    } catch (error: unknown) {
      const parsed = parseUnipileError(error);
      console.error(`[Unipile] listAccounts failed:`, parsed.message);
      return { success: false, error: parsed.code, message: parsed.message };
    }
  }

  // ── fetchAccountById ──────────────────────────────────────────────────────

  /** Gets account details for a given Unipile account ID. */
  async fetchAccountById(accountId: string): Promise<UnipileResponse> {
    try {
      const response = await this.sdk.account.getOne(accountId);
      return { success: true, data: response };
    } catch (error: unknown) {
      const parsed = parseUnipileError(error);
      console.error(
        `[Unipile] fetchAccountById failed for "${accountId}":`,
        parsed.message
      );
      return { success: false, error: parsed.code, message: parsed.message };
    }
  }

  // ── createHostedAuthLink ──────────────────────────────────────────────────

  /**
   * Creates a Unipile hosted auth link for OAuth-based LinkedIn account
   * connection. Link expires in 30 minutes.
   */
  async createHostedAuthLink(params: {
    success_redirect_url: string;
    failure_redirect_url: string;
    user_id: string;
  }): Promise<UnipileResponse> {
    try {
      const expiresOn = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const response = await this.sdk.account.createHostedAuthLink({
        type: 'create',
        providers: '*',
        api_url: this.baseUrl,
        expiresOn,
        success_redirect_url: params.success_redirect_url,
        failure_redirect_url: params.failure_redirect_url,
      });

      return { success: true, data: response };
    } catch (error: unknown) {
      const parsed = parseUnipileError(error);
      console.error(`[Unipile] createHostedAuthLink failed:`, parsed.message);
      return { success: false, error: parsed.code, message: parsed.message };
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let unipileClient: UnipileClient | null = null;

export function getUnipileClient(): UnipileClient {
  if (!unipileClient) {
    unipileClient = new UnipileClient();
  }
  return unipileClient;
}

export default UnipileClient;