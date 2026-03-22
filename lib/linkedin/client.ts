import { randomUUID } from 'crypto';

const VOYAGER = 'https://www.linkedin.com/voyager/api';
const DEFAULT_MESSENGER_CONVERSATIONS_QUERY_ID =
  process.env.LINKEDIN_MESSENGER_CONVERSATIONS_QUERY_ID ||
  'messengerConversations.0d5e6781bbee71c3e51c8843c6519f48';
const DEFAULT_MESSENGER_MESSAGES_QUERY_ID =
  process.env.LINKEDIN_MESSENGER_MESSAGES_QUERY_ID ||
  'messengerMessages.5846eeb71c981f11e0134cb6626cc314';

const MESSENGER_CONVERSATIONS_QUERY_ID_CANDIDATES = [
  ...(process.env.LINKEDIN_MESSENGER_CONVERSATIONS_QUERY_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
  DEFAULT_MESSENGER_CONVERSATIONS_QUERY_ID,
];

const MESSENGER_MESSAGES_QUERY_ID_CANDIDATES = [
  ...(process.env.LINKEDIN_MESSENGER_MESSAGES_QUERY_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
  DEFAULT_MESSENGER_MESSAGES_QUERY_ID,
];

const HARDCODED_MESSENGER_CONVERSATIONS_QUERY_ID =
  'messengerConversations.74c17e85611b60b7ba2700481151a316';

/**
 * LinkedIn profile GraphQL query ID.
 * Tied to LinkedIn's frontend deployment — override via env var if LinkedIn
 * updates their frontend and this query ID changes.
 */
const PROFILE_QUERY_ID =
  process.env.LINKEDIN_PROFILE_QUERY_ID ||
  'voyagerIdentityDashProfiles.34ead06db82a2cc9a778fac97f69ad6a';

// ─── Error Codes ──────────────────────────────────────────────────────────────

export type LinkedInErrorCode =
  | 'already_invited'       // Invitation already pending
  | 'already_connected'     // Lead is already a 1st-degree connection
  | 'account_disconnected'  // li_at expired, account restricted, or checkpoint
  | 'rate_limited'          // 429 or weekly invitation quota hit
  | 'note_too_long'         // Connection note > 300 chars
  | 'not_connected'         // Cannot message — not a 1st-degree connection yet
  | 'session_expired'       // JSESSIONID expired and could not be refreshed
  | 'network_error'         // Cloudflare / proxy HTML response
  | 'unknown_error';

// ─── Shared Interfaces ────────────────────────────────────────────────────────

/** Enriched lead data — identical shape to the Unipile client for DB compatibility */
export interface LeadProfileData {
  provider_id: string;            // urn:li:fsd_profile:XXX
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

export interface LinkedInResponse {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  included?: any[];
  error?: LinkedInErrorCode;
  message?: string;
  alreadyInvited?: boolean;
  alreadyConnected?: boolean;
  profileData?: LeadProfileData;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the bare vanity name from a LinkedIn profile URL.
 *   "https://www.linkedin.com/in/john-doe/" → "john-doe"
 *   "john-doe"                               → "john-doe" (pass-through)
 */
export function extractLinkedInIdentifier(url: string): string {
  if (!url) return url;
  const match = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (match?.[1]) return match[1].replace(/\/$/, '');
  return url.trim();
}

/** Standard Voyager request headers */
function buildHeaders(
  jsessionid: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    accept: 'application/vnd.linkedin.normalized+json+2.1', // The fetch function will override this with application/graphql when needed
    'accept-language': 'en-US,en;q=0.9', // Updated from q=0.8
    'cache-control': 'no-cache',
    'csrf-token': jsessionid,
    pragma: 'no-cache',
    priority: 'u=1, i', // Added from cURL
    'sec-ch-prefers-color-scheme': 'dark', // Added from cURL
    'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"', // Added from cURL
    'sec-ch-ua-mobile': '?0', // Added from cURL
    'sec-ch-ua-platform': '"Windows"', // Added from cURL
    'sec-fetch-dest': 'empty', // Added from cURL
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36', // Updated to Chrome 146
    'x-li-lang': 'en_US',
    'x-li-track': JSON.stringify({
      clientVersion: '1.13.42962', // Updated to match cURL build
      mpVersion: '1.13.42962',     // Updated to match cURL build
      osName: 'web',
      timezoneOffset: 5.5,         // Updated to match cURL
      timezone: 'Asia/Calcutta',   // Updated to match cURL
      deviceFormFactor: 'DESKTOP',
      mpName: 'voyager-web',
      displayDensity: 1.25,        // Updated to match cURL
      displayWidth: 1920,
      displayHeight: 1200,         // Updated to match cURL
    }),
    'x-restli-protocol-version': '2.0.0',
    ...extra,
  };
}

/** Cookie string for all authenticated requests */
function buildCookie(liAt: string, jsessionid: string): string {
  // Cookie requires quoted JSESSIONID; csrf-token header uses the bare value
  return `li_at=${liAt}; JSESSIONID="${jsessionid}"`;
}

function findStringByPrefix(value: unknown, prefix: string): string | null {
  if (typeof value === 'string') {
    return value.startsWith(prefix) ? value : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByPrefix(item, prefix);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) {
      const found = findStringByPrefix(entry, prefix);
      if (found) return found;
    }
  }

  return null;
}

interface ParsedError {
  code: LinkedInErrorCode;
  message: string;
}

/** Maps an HTTP status + response body to a clean error code */
function parseLinkedInError(status: number, body: unknown): ParsedError {
  const bodyStr =
    typeof body === 'string' ? body : JSON.stringify(body ?? '');

  // Cloudflare / proxy HTML error
  if (
    bodyStr.trimStart().startsWith('<!DOCTYPE') ||
    bodyStr.trimStart().toLowerCase().startsWith('<html')
  ) {
    return {
      code: 'network_error',
      message: 'Network error: Received HTML payload instead of JSON (proxy/Cloudflare timeout)',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let obj: any = {};
  if (typeof body === 'object' && body !== null) {
    obj = body;
  } else if (typeof body === 'string') {
    try { obj = JSON.parse(body); } catch { /* ignore */ }
  }

  const msg: string = obj?.message ?? obj?.errorDetailMessage ?? '';

  if (status === 401 || status === 403) {
    return {
      code: 'account_disconnected',
      message: 'Session expired or account restricted. Please reconnect your LinkedIn account.',
    };
  }
  if (status === 429) {
    return { code: 'rate_limited', message: msg || 'Rate limit reached. Too many requests.' };
  }
  if (status === 422) {
    if (msg.toLowerCase().includes('weekly') || msg.toLowerCase().includes('quota')) {
      return { code: 'rate_limited', message: msg || 'Weekly invitation limit reached' };
    }
    if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('pending')) {
      return { code: 'already_invited', message: msg || 'Invitation already pending' };
    }
    if (
      msg.toLowerCase().includes('recipient') ||
      msg.toLowerCase().includes('cannot be reached')
    ) {
      return { code: 'not_connected', message: msg || 'Recipient cannot be reached' };
    }
  }
  if (status === 400 && msg.toLowerCase().includes('character')) {
    return { code: 'note_too_long', message: 'Connection note exceeds the 300-character limit' };
  }

  return { code: 'unknown_error', message: msg || `HTTP ${status}` };
}

// ─── Profile Extraction ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLeadProfile(profileEntity: any): LeadProfileData {
  const firstName: string | null = profileEntity?.firstName ?? null;
  const lastName: string | null = profileEntity?.lastName ?? null;
  const fullName =
    firstName || lastName
      ? [firstName, lastName].filter(Boolean).join(' ')
      : null;

  // Profile picture — use the largest artifact
  let profilePicUrl: string | null = null;
  const vectorImage =
    profileEntity?.profilePicture?.displayImageReference?.vectorImage;
  if (vectorImage?.rootUrl && vectorImage?.artifacts?.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sorted = [...vectorImage.artifacts].sort(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any, b: any) => (b.width ?? 0) - (a.width ?? 0)
    );
    profilePicUrl = `${vectorImage.rootUrl}${sorted[0].fileIdentifyingUrlPathSegment}`;
  }

  const vanityName: string | null = profileEntity?.publicIdentifier ?? null;

  // Current position — first entry from position groups or flat positions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positions: any[] =
    profileEntity?.profilePositionGroups?.elements ??
    profileEntity?.positions?.elements ??
    [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = positions.find((p: any) => !p.dateRange?.end) ?? positions[0] ?? null;

  return {
    provider_id: profileEntity?.entityUrn ?? null,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    headline: profileEntity?.headline ?? null,
    location:
      profileEntity?.geoLocation?.geo?.defaultLocalizedName ??
      profileEntity?.location?.defaultLocalizedName ??
      null,
    profile_pic_url: profilePicUrl,
    public_profile_url: vanityName
      ? `https://www.linkedin.com/in/${vanityName}/`
      : null,
    company: current?.companyName ?? null,
    title: current?.title ?? null,
  };
}

// ─── Session Bootstrap ────────────────────────────────────────────────────────

/**
 * Obtains a fresh JSESSIONID by making an authenticated GET to /voyager/api/me.
 * LinkedIn sets JSESSIONID in the Set-Cookie response header on the first
 * authenticated request. Only the li_at cookie is needed as input.
 *
 * Call this once during account setup, and again if a request returns 401/403.
 */
export async function bootstrapSession(liAt: string): Promise<string> {
  const response = await fetch('https://www.linkedin.com/', {
    headers: {
      'Cookie': `li_at=${liAt}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
    redirect: 'follow' // LinkedIn often redirects from / to /feed/ when authenticated
  });

  if (!response.ok) {
    throw new Error(`LinkedIn returned HTTP ${response.status}. The li_at token may be invalid or expired.`);
  }

  // Use getSetCookie() if available (Node 18+), otherwise fallback to standard get()
  const setCookies: string[] =
    typeof (response.headers as any).getSetCookie === 'function'
      ? (response.headers as any).getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];

  for (const cookie of setCookies) {
    /**
     * Updated Regex:
     * 1. Matches "JSESSIONID="
     * 2. Handles optional starting double quote
     * 3. Captures the "ajax:..." string
     * 4. Stops at a closing quote, semicolon, or space
     */
    const match = cookie.match(/JSESSIONID=["']?(ajax:[^"';\s]+)["']?/);

    if (match?.[1]) {
      // Return the raw ajax: string to be used as the 'csrf-token' header
      return match[1];
    }
  }

  throw new Error('JSESSIONID not found in LinkedIn response. Check if li_at is still valid.');
}

/**
 * Fetches the logged-in user's own profile to get their fsd_profile URN.
 * Used during account setup — the URN is stored as mailboxUrn for messaging.
 */
export async function getOwnProfile(
  liAt: string,
  jsessionid: string
): Promise<{ profileUrn: string; vanityName: string; firstName: string; lastName: string }> {

  const meRes = await fetch(`${VOYAGER}/me`, {
    headers: {
      ...buildHeaders(jsessionid), // Must include 'csrf-token': jsessionid
      'Cookie': `li_at=${liAt}; JSESSIONID="${jsessionid}"`, //
      'Accept': 'application/vnd.linkedin.normalized+json+2.1',
    },
  });

  if (!meRes.ok) throw new Error(`GET /me failed: HTTP ${meRes.status}`);

  const meData = await meRes.json();

  /**
   * Data Extraction based on your metadata:
   * The 'included' array contains the MiniProfile object with the names and URNs.
   */
  const included = meData?.included || [];
  const miniProfile = included.find(
    (item: any) => item['$type'] === 'com.linkedin.voyager.identity.shared.MiniProfile'
  );

  if (!miniProfile) {
    throw new Error('Could not find MiniProfile in the LinkedIn response included array.');
  }

  // dashEntityUrn is the fsd_profile URN needed for Step 3 of your flow
  const profileUrn = miniProfile.dashEntityUrn;
  const vanityName = miniProfile.publicIdentifier; // e.g., 'rittik-singh-0480a539a'
  const firstName = miniProfile.firstName || '';
  const lastName = miniProfile.lastName || '';

  if (!profileUrn || !vanityName) {
    throw new Error('Required profile identifiers (URN or Vanity Name) are missing from the response.');
  }

  // These values are now ready to be saved to your 'linkedin_accounts' table
  return {
    profileUrn,
    vanityName,
    firstName,
    lastName
  };
}

// ─── LinkedIn Client ──────────────────────────────────────────────────────────

/**
 * Callback invoked when JSESSIONID is refreshed mid-request.
 * Use this to persist the new value to the database.
 */
type OnSessionRefresh = (newJsessionid: string) => Promise<void>;

export class LinkedInClient {
  private liAt: string;
  private jsessionid: string;
  /** The account owner's own fsd_profile URN — used as mailboxUrn in messages */
  private profileUrn: string;
  private onSessionRefresh: OnSessionRefresh | null;
  private discoveredConversationQueryIds: string[] = [];
  private discoveredMessageQueryIds: string[] = [];
  private queryDiscoveryAttempted = false;

  constructor(
    liAt: string,
    jsessionid: string,
    profileUrn: string,
    onSessionRefresh: OnSessionRefresh | null = null
  ) {
    this.liAt = liAt;
    this.jsessionid = jsessionid;
    this.profileUrn = profileUrn;
    this.onSessionRefresh = onSessionRefresh;
  }

  private get cookie(): string {
    return buildCookie(this.liAt, this.jsessionid);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...buildHeaders(this.jsessionid, extra), Cookie: this.cookie };
  }

  private mailboxUrnCandidates(): string[] {
    const candidates = new Set<string>();
    const urn = (this.profileUrn || '').trim();
    if (!urn) return [];

    candidates.add(urn);
    candidates.add(`"${urn}"`);

    if (urn.startsWith('urn:li:member:')) {
      const id = urn.replace('urn:li:member:', '');
      candidates.add(`urn:li:fsd_profile:${id}`);
      candidates.add(`"urn:li:fsd_profile:${id}"`);
    }

    if (urn.startsWith('urn:li:fs_miniProfile:')) {
      const id = urn.replace('urn:li:fs_miniProfile:', '');
      candidates.add(`urn:li:fsd_profile:${id}`);
      candidates.add(`"urn:li:fsd_profile:${id}"`);
    }

    return Array.from(candidates);
  }

  private async discoverMessagingQueryIds(): Promise<void> {
    if (this.queryDiscoveryAttempted) return;
    this.queryDiscoveryAttempted = true;

    try {
      const res = await fetch('https://www.linkedin.com/messaging/', {
        method: 'GET',
        headers: {
          Cookie: this.cookie,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.8',
          'csrf-token': this.jsessionid,
          referer: 'https://www.linkedin.com/',
        },
      });

      if (!res.ok) return;
      const html = await res.text();

      const convMatches = html.match(/messengerConversations\.[a-f0-9]{32}/gi) || [];
      const msgMatches = html.match(/messengerMessages\.[a-f0-9]{32}/gi) || [];

      this.discoveredConversationQueryIds = Array.from(new Set(convMatches));
      this.discoveredMessageQueryIds = Array.from(new Set(msgMatches));
    } catch {
      // Best-effort discovery only.
    }
  }

  private conversationQueryIdCandidates(): string[] {
    return Array.from(new Set([
      ...this.discoveredConversationQueryIds,
      ...MESSENGER_CONVERSATIONS_QUERY_ID_CANDIDATES,
    ]));
  }

  private messageQueryIdCandidates(): string[] {
    return Array.from(new Set([
      ...this.discoveredMessageQueryIds,
      ...MESSENGER_MESSAGES_QUERY_ID_CANDIDATES,
    ]));
  }

  /**
   * Refreshes JSESSIONID from li_at when a 401/403 is received.
   * Persists the new value via the onSessionRefresh callback.
   */
  private async tryRefreshSession(): Promise<boolean> {
    try {
      this.jsessionid = await bootstrapSession(this.liAt);
      if (this.onSessionRefresh) await this.onSessionRefresh(this.jsessionid);
      return true;
    } catch {
      return false;
    }
  }

  // ── getProfile ──────────────────────────────────────────────────────────────

  /**
   * Fetches a LinkedIn profile by URL or bare vanity name.
   * Returns the raw profile entity + extracted LeadProfileData.
   */
  async getProfile(linkedinUrl: string): Promise<LinkedInResponse> {
    const vanityName = extractLinkedInIdentifier(linkedinUrl);
    const url = `${VOYAGER}/graphql?variables=(vanityName:${vanityName})&queryId=${PROFILE_QUERY_ID}`;

    let res = await fetch(url, { headers: this.headers() });

    if (res.status === 401 || res.status === 403) {
      if (await this.tryRefreshSession()) {
        res = await fetch(url, { headers: this.headers() });
      }
    }

    if (!res.ok) {
      const { code, message } = parseLinkedInError(res.status, await res.text());
      return { success: false, error: code, message };
    }

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const included: any[] = data?.included ?? [];
    const normalizedVanity = vanityName.toLowerCase();
    const isProfileEntity = (e: any) =>
      typeof e?.entityUrn === 'string' && e.entityUrn.startsWith('urn:li:fsd_profile:');

    const entity =
      included.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) =>
          isProfileEntity(e) &&
          typeof e?.publicIdentifier === 'string' &&
          e.publicIdentifier.toLowerCase() === normalizedVanity
      ) ??
      included.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) =>
          isProfileEntity(e) &&
          typeof e?.publicIdentifier === 'string' &&
          e.publicIdentifier.toLowerCase().includes(normalizedVanity)
      ) ??
      included.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => isProfileEntity(e) && e.entityUrn !== this.profileUrn
      ) ??
      included.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => isProfileEntity(e)
      );

    if (!entity) {
      return { success: false, error: 'unknown_error', message: 'Profile not found in response' };
    }

    return {
      success: true,
      data: entity,
      included,
      profileData: extractLeadProfile(entity),
    };
  }

  // ── sendConnectionRequest ───────────────────────────────────────────────────

  /**
   * Sends a LinkedIn connection request.
   *   1. Resolves the target's fsd_profile URN via getProfile
   *   2. Pre-flight checks: already connected / already invited
   *   3. Client-side note length validation (300-char limit)
   *   4. POSTs to the Voyager invitation endpoint
   */
  async sendConnectionRequest(params: {
    linkedin_url: string;
    message?: string | null;
  }): Promise<LinkedInResponse> {
    // Step 1: Resolve the profile and get all included metadata
    const profileResult = await this.getProfile(params.linkedin_url);

    if (!profileResult.success || !profileResult.data) {
      return {
        success: false,
        error: profileResult.error ?? 'unknown_error',
        message: profileResult.message,
      };
    }

    // Cast the data for easier access to the Profile object and the included array
    const profile = profileResult.data as any;
    const included = profileResult.included ?? []; // Use 'included' to find relationship status
    const targetUrn: string | null = profile?.entityUrn ?? null;
    const profileData = profileResult.profileData;

    if (!targetUrn) {
      return { success: false, error: 'unknown_error', message: 'Could not resolve profile URN', profileData };
    }

    /**
     * Pre-check: Already 1st-degree?
     * We search the 'included' array for the MemberRelationship object.
     */
    const relationship = included.find(
      (i: any) => i.$type === 'com.linkedin.voyager.dash.relationships.MemberRelationship'
    );

    // 'DISTANCE_1' means you are already connected.
    if (relationship?.distance?.value === 'DISTANCE_1') {
      return {
        success: false,
        alreadyConnected: true,
        error: 'already_connected',
        message: 'Already a 1st-degree connection',
        profileData,
      };
    }

    // Client-side note length guard (300-char LinkedIn hard limit)
    if (params.message && params.message.length > 300) {
      return {
        success: false,
        error: 'note_too_long',
        message: `Note is ${params.message.length} chars — LinkedIn limit is 300`,
        profileData,
      };
    }

    /**
     * Step 2: Send invitation
     * The 'memberProfile' field must be the fsd_profile URN.
     */
    const body: Record<string, unknown> = {
      invitee: {
        inviteeUnion: {
          memberProfile: targetUrn
        }
      },
    };

    // LinkedIn uses 'customMessage' for the invite note
    if (params.message) {
      body.customMessage = params.message;
    }

    const url = `${VOYAGER}/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2`;

    // Standard headers including the critical 'csrf-token'
    const fetchOptions = {
      method: 'POST',
      headers: this.headers({
        'content-type': 'application/json; charset=UTF-8',
        'accept': 'application/vnd.linkedin.normalized+json+2.1' //
      }),
      body: JSON.stringify(body),
    };

    let res = await fetch(url, fetchOptions);

    // Handle session expiration by attempting a refresh
    if (res.status === 401 || res.status === 403) {
      if (await this.tryRefreshSession()) {
        // Re-generate headers with the new jsessionid/csrf-token
        fetchOptions.headers = this.headers({
          'content-type': 'application/json; charset=UTF-8',
          'accept': 'application/vnd.linkedin.normalized+json+2.1'
        });
        res = await fetch(url, fetchOptions);
      }
    }

    if (!res.ok) {
      const resBody = await res.json().catch(() => ({}));
      const { code, message } = parseLinkedInError(res.status, resBody);

      if (code === 'already_invited') {
        return { success: false, alreadyInvited: true, error: code, message, profileData };
      }
      return { success: false, error: code, message, profileData };
    }

    return { success: true, data: await res.json(), profileData };
  }

  // ── sendMessage ─────────────────────────────────────────────────────────────

  /**
   * Sends a direct LinkedIn message via the Messenger API.
   * If provider_id (fsd_profile URN) is already stored in the DB,
   * the getProfile round-trip is skipped.
   *
   * Note: LinkedIn requires content-type "text/plain" for this endpoint
   * even though the body is JSON — this is intentional.
   */

  async sendMessage(params: {
    linkedin_url: string;
    message: string;
    provider_id?: string | null;
    conversation_urn?: string | null;
    quick_action_context_urn?: string | null;
  }): Promise<LinkedInResponse> {
    let recipientUrn = params.provider_id ?? null;

    if (!recipientUrn) {
      const profileResult = await this.getProfile(params.linkedin_url);
      if (!profileResult.success) {
        return { success: false, error: profileResult.error, message: profileResult.message };
      }
      recipientUrn = (profileResult.data as any)?.entityUrn ?? null;
    }

    console.log("[sendMessage] Resolved recipientUrn:", recipientUrn);

    if (!recipientUrn) {
      return { success: false, error: 'unknown_error', message: 'Could not resolve recipient URN' };
    }

    const url = `${VOYAGER}/voyagerMessagingDashMessengerMessages?action=createMessage`;

    // ✅ trackingId must be raw binary bytes from a UUID, not a plain UUID string
    const trackingIdBytes = this.uuidToBytes(randomUUID());

    const baseMessage = {
      body: {
        attributes: [],
        text: params.message,
      },
      originToken: randomUUID(),
      renderContentUnions: [],
    } as Record<string, unknown>;

    if (params.conversation_urn) {
      baseMessage.conversationUrn = params.conversation_urn;
    }

    const body: Record<string, unknown> = {
      message: baseMessage,
      mailboxUrn: this.profileUrn,
      trackingId: trackingIdBytes,
      dedupeByClientGeneratedToken: false,
    };

    if (params.conversation_urn) {
      if (params.quick_action_context_urn) {
        body.quickActionContextUrn = params.quick_action_context_urn;
      }
    } else {
      body.hostRecipientUrns = [recipientUrn];
    }

    console.log("[sendMessage] Request body:", JSON.stringify(body, null, 2));
    console.log("[sendMessage] Request URL:", url);

    const extraHeaders = {
      'content-type': 'text/plain;charset=UTF-8',
      'origin': 'https://www.linkedin.com',
      'referer': 'https://www.linkedin.com/preload/',
      'priority': 'u=1, i',
      'sec-gpc': '1',
      'sec-ch-ua': '"Not:A-Brand";v="99", "Brave";v="145", "Chromium";v="145"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'x-li-page-instance': 'urn:li:page:d_flagship3_profile_view_base;Ur5/eTnHQPqPg45p6GrC9A==',
    };

    let res = await fetch(url, {
      method: 'POST',
      headers: this.headers(extraHeaders),
      body: JSON.stringify(body),
    });

    console.log("[sendMessage] Response status:", res.status);

    if (res.status === 401 || res.status === 403) {
      console.log("[sendMessage] Auth error, attempting session refresh...");
      if (await this.tryRefreshSession()) {
        console.log("[sendMessage] Session refreshed, retrying...");
        res = await fetch(url, {
          method: 'POST',
          headers: this.headers(extraHeaders),
          body: JSON.stringify(body),
        });
        console.log("[sendMessage] Retry response status:", res.status);
      }
    }

    if (!res.ok) {
      const resBody = await res.json().catch(() => ({}));
      console.log("[sendMessage] Error response body:", JSON.stringify(resBody, null, 2));
      const { code, message } = parseLinkedInError(res.status, resBody);
      return { success: false, error: code, message };
    }

    const responseData = await res.json();
    console.log("[sendMessage] Success:", JSON.stringify(responseData, null, 2));
    return { success: true, data: responseData };
  }

  async fetchConversationsByIds(conversationUrns: string[]): Promise<LinkedInResponse> {
    if (!conversationUrns.length) {
      return { success: true, data: {} };
    }

    const idsExpr = `List(${conversationUrns.join(',')})`;
    const url = `${VOYAGER}/voyagerMessagingDashMessengerConversations?ids=${encodeURIComponent(idsExpr)}`;

    let res = await fetch(url, {
      method: 'GET',
      headers: this.headers({
        accept: 'application/json',
        'content-type': 'text/plain;charset=UTF-8',
      }),
    });

    if (res.status === 401 || res.status === 403) {
      if (await this.tryRefreshSession()) {
        res = await fetch(url, {
          method: 'GET',
          headers: this.headers({
            accept: 'application/json',
            'content-type': 'text/plain;charset=UTF-8',
          }),
        });
      }
    }

    if (!res.ok) {
      const { code, message } = parseLinkedInError(res.status, await res.text());
      return { success: false, error: code, message };
    }

    const data = await res.json();
    return { success: true, data };
  }

  async fetchMailboxConversations(params?: { start?: number; count?: number; syncToken?: string }): Promise<LinkedInResponse> {
    void params;

    const mailboxUrn = (this.profileUrn || '').trim();
    if (!mailboxUrn) {
      return { success: false, error: 'unknown_error', message: 'Missing mailbox URN' };
    }

    // Keep request shape hardcoded, only mailboxUrn/auth are dynamic per account.
    const workingVariables = `(mailboxUrn:${encodeURIComponent(mailboxUrn)})`;

    // Constructing the exact URL that worked before
    const url = `${VOYAGER}/voyagerMessagingGraphQL/graphql?queryId=${HARDCODED_MESSENGER_CONVERSATIONS_QUERY_ID}&variables=${workingVariables}`;

    // Safely remove any accidental extra quotes from the JSESSIONID just in case it was saved weirdly in the DB
    const cleanJsessionId = (this.jsessionid || '').replace(/"/g, '');

    const minimalHeaders = {
      'accept': 'application/graphql',
      'accept-language': 'en-US,en;q=0.8',
      'cache-control': 'no-cache',
      'x-restli-protocol-version': '2.0.0',
      'csrf-token': cleanJsessionId, // Mandatory for preventing 403 Forbidden
      'cookie': `li_at=${this.liAt}; JSESSIONID="${cleanJsessionId}";` 
    };

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: minimalHeaders,
      });

      // 2. Safely check if the response is OK FIRST before trying to parse JSON
      if (res.ok) {
        const data = await res.json();
        console.log("[fetchMailboxConversations] Success! Data fetched.");
        return { success: true, data };
      }

      // 3. If it's an error (400, 401, 403, etc.), read as text so it doesn't crash on HTML error pages
      const bodyText = await res.text().catch(() => '');
      console.warn(`[fetchMailboxConversations] Warning: HTTP ${res.status}`, bodyText);

      // Pass it to your custom error parser
      // @ts-ignore
      const parsed = parseLinkedInError(res.status, bodyText);
      
      return { 
        success: false, 
        error: parsed.code || `HTTP_${res.status}`, 
        message: parsed.message || `HTTP ${res.status} error from LinkedIn` 
      };

    } catch (error: any) {
      // 4. Clean catch block for actual network failures (e.g., internet down, DNS issues)
      const message = error instanceof Error ? error.message : 'Mailbox request failed';
      console.error("[fetchMailboxConversations] Network or execution error:", message);
      
      return { success: false, error: 'network_error', message };
    }
  }
  async fetchConversationMessages(
    conversationUrn: string,
    params?: { syncToken?: string }
  ): Promise<LinkedInResponse> {

    // 1. Format variables exactly like the cURL trace.
    // In the cURL, the URN and token values are URL-encoded, but the outer brackets () 
    // and the keys (conversationUrn:, syncToken:) are NOT encoded.
    const encodedUrn = encodeURIComponent(conversationUrn);
    const variablesString = params?.syncToken 
      ? `(conversationUrn:${encodedUrn},syncToken:${encodeURIComponent(params.syncToken)})`
      : `(conversationUrn:${encodedUrn})`;

    const queryId = 'messengerMessages.5846eeb71c981f11e0134cb6626cc314';
    const url = `${VOYAGER}/voyagerMessagingGraphQL/graphql?queryId=${queryId}&variables=${variablesString}`;

    // Dynamically extract the thread ID from the URN to build the exact referer URL.
    const threadIdMatch = conversationUrn.match(/,([^,)]+)\)$/);
    const threadId = threadIdMatch ? threadIdMatch[1] : conversationUrn.replace(/.*[:,]/, '').replace(/\)$/, '');
    const refererUrl = threadId
      ? `https://www.linkedin.com/messaging/thread/${threadId}/`
      : 'https://www.linkedin.com/messaging/';

    // Safely format the JSESSIONID (remove quotes if present in DB)
    const cleanJsessionId = (this.jsessionid || '').replace(/"/g, '');

    // 2. Minimal, exact headers to prevent 401/403
    const minimalHeaders = {
      'accept': 'application/graphql',
      'accept-language': 'en-US,en;q=0.8',
      'cache-control': 'no-cache',
      'x-restli-protocol-version': '2.0.0',
      'referer': refererUrl,
      'csrf-token': cleanJsessionId, // Mandatory matching token
      'cookie': `li_at=${this.liAt}; JSESSIONID="${cleanJsessionId}";`
    };

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: minimalHeaders,
      });
      console.log(`[fetchConversationMessages] Response status for thread ${threadId}:`, res.status);
      // 3. Safely check OK before parsing JSON
      if (res.ok) {
        const data = await res.json();
        console.log(`[fetchConversationMessages] Success for thread ${threadId}`);
        return { success: true, data };
      }

      // 4. Handle HTTP errors (400, 403, etc.) safely without crashing
      const bodyText = await res.text().catch(() => '');
      console.warn(`[fetchConversationMessages] HTTP ${res.status}`, bodyText);

      // @ts-ignore
      const parsed = parseLinkedInError(res.status, bodyText);
      
      return { 
        success: false, 
        error: parsed.code || `HTTP_${res.status}`, 
        message: parsed.message || `HTTP ${res.status} error from LinkedIn` 
      };

    } catch (error: any) {
      // 5. Network/Execution failure handling
      const message = error instanceof Error ? error.message : 'Messages request failed';
      console.error("[fetchConversationMessages] Network error:", message);
      
      return { success: false, error: 'network_error', message };
    }
  }

  extractConversationUrn(payload: unknown): string | null {
    return findStringByPrefix(payload, 'urn:li:msg_conversation:');
  }

  extractMessageUrn(payload: unknown): string | null {
    return findStringByPrefix(payload, 'urn:li:msg_message:');
  }

  // ✅ Converts UUID string to raw binary byte string (what LinkedIn expects for trackingId)
  private uuidToBytes(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    let binary = '';
    for (let i = 0; i < hex.length; i += 2) {
      binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return binary;
  }

  // ── getRecentConnections ────────────────────────────────────────────────────

  /**
   * Fetches the 40 most recently accepted connections for this account.
   * Used by check-connections to detect accepted invitations in bulk.
   * Returns the raw `included` array — each element has `entityUrn` (fsd_profile URN).
   */
  async getRecentConnections(): Promise<LinkedInResponse> {
    const url = `${VOYAGER}/relationships/dash/connections?decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16&count=40&q=search&sortType=RECENTLY_ADDED`;

    let res = await fetch(url, {
      headers: this.headers({ 'x-li-deco-include-micro-schema': 'true' }),
    });

    if (res.status === 401 || res.status === 403) {
      if (await this.tryRefreshSession()) {
        res = await fetch(url, {
          headers: this.headers({ 'x-li-deco-include-micro-schema': 'true' }),
        });
      }
    }

    if (!res.ok) {
      const { code, message } = parseLinkedInError(res.status, await res.text());
      return { success: false, error: code, message };
    }

    const data = await res.json();
    return { success: true, data };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a LinkedInClient from a DB account record.
 * Pass a Supabase admin client + account ID as onSessionRefresh so refreshed
 * JSESSIONID values are automatically persisted to the database.
 */
export function createLinkedInClient(
  account: { li_at: string; jsessionid: string; profile_urn: string },
  onSessionRefresh?: OnSessionRefresh
): LinkedInClient {
  return new LinkedInClient(
    account.li_at,
    account.jsessionid,
    account.profile_urn,
    onSessionRefresh ?? null
  );
}