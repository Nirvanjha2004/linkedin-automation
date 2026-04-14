import { randomUUID } from 'crypto';

const VOYAGER = 'https://www.linkedin.com/voyager/api';
const MESSENGER_MESSAGES_QUERY_ID =
  process.env.LINKEDIN_MESSENGER_MESSAGES_QUERY_ID ||
  'messengerMessages.5846eeb71c981f11e0134cb6626cc314';

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
  | 'network_error'         // Cloudflare / proxy HTML response
  | 'unknown_error';

// ─── Shared Interfaces ────────────────────────────────────────────────────────

/** Enriched lead data — identical shape to the Unipile client for DB compatibility */
export interface LeadProfileData {
  provider_id: string | null;     // urn:li:fsd_profile:XXX
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
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'csrf-token': jsessionid,
    pragma: 'no-cache',
    priority: 'u=1, i',
    'sec-ch-prefers-color-scheme': 'dark',
    'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    'x-li-lang': 'en_US',
    'x-li-track': JSON.stringify({
      clientVersion: '1.13.42962',
      mpVersion: '1.13.42962',
      osName: 'web',
      timezoneOffset: 5.5,
      timezone: 'Asia/Calcutta',
      deviceFormFactor: 'DESKTOP',
      mpName: 'voyager-web',
      displayDensity: 1.25,
      displayWidth: 1920,
      displayHeight: 1200,
    }),
    'x-restli-protocol-version': '2.0.0',
    ...extra,
  };
}

/** Cookie string for all authenticated requests */
function buildCookie(liAt: string, jsessionid: string): string {
  return `li_at=${liAt}; JSESSIONID="${jsessionid}"`;
}

function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
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
function extractLeadProfile(profileEntity: any, included: any[] = []): LeadProfileData {
  const firstName: string | null = profileEntity?.firstName ?? null;
  const lastName: string | null = profileEntity?.lastName ?? null;
  const fullName =
    firstName || lastName
      ? [firstName, lastName].filter(Boolean).join(' ')
      : null;

  // Profile picture — use the largest artifact
  let profilePicUrl: string | null = null;
  const vectorImage =
    profileEntity?.profilePicture?.displayImageReferenceResolutionResult?.vectorImage ??
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
  const profileUrn: string | null = profileEntity?.entityUrn ?? null;

  // ── Current Position Resolution ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentPosition: any = null;

  // Strategy 1: profileTopPosition['*elements'] URN list
  const topPositionUrns: string[] =
    profileEntity?.profileTopPosition?.['*elements'] ??
    profileEntity?.['*profileTopPosition'] ??
    [];

  if (topPositionUrns.length > 0 && included.length > 0) {
    currentPosition = included.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => topPositionUrns.includes(e.entityUrn)
    ) ?? null;
  }

  // Strategy 2: scan included for Position entities belonging to this profile
  if (!currentPosition && profileUrn && included.length > 0) {
    const profileId = profileUrn.split(':').pop();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const positions = included.filter((e: any) => {
      if (typeof e.entityUrn !== 'string') return false;
      return (
        e.entityUrn.startsWith(`urn:li:fsd_profilePosition:(${profileId}`) ||
        (e.entityUrn.includes('fsd_profilePosition') && e.entityUrn.includes(profileId ?? ''))
      );
    });
    currentPosition =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      positions.find((p: any) => !p.timePeriod?.end && !p.dateRange?.end) ??
      positions[0] ??
      null;
  }

  // Strategy 3: experienceCard reference in included
  if (!currentPosition && included.length > 0) {
    const experienceCardUrn: string | null =
      profileEntity?.['*experienceCard'] ?? null;
    if (experienceCardUrn) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const card = included.find((e: any) => e.entityUrn === experienceCardUrn);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topComponent = card?.topComponents?.[0] ?? card?.components?.[0] ?? null;
      currentPosition = topComponent?.components?.entityComponent ?? topComponent ?? null;
    }
  }

  // ── Location Resolution ───────────────────────────────────────────────────
  // Try to resolve from included geo entity first, then inline fallbacks.
  // NOTE: if geo is not in included, resolveGeoLocation() will fetch it separately.
  let location: string | null = null;
  const geoUrn: string | null = profileEntity?.geoLocation?.['*geo'] ?? null;
  if (geoUrn && included.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoEntity = included.find((e: any) => e.entityUrn === geoUrn || e['$id'] === geoUrn);
    location = geoEntity?.defaultLocalizedName ?? geoEntity?.name ?? null;
  }
  if (!location) {
    location =
      profileEntity?.geoLocation?.geo?.defaultLocalizedName ??
      profileEntity?.location?.defaultLocalizedName ??
      profileEntity?.location?.countryCode?.toUpperCase() ??
      null;
  }

  // ── Company + Title Resolution ────────────────────────────────────────────
  // Primary: from resolved position entity
  let company: string | null =
    currentPosition?.companyName ?? currentPosition?.company?.name ?? null;
  let title: string | null = currentPosition?.title ?? null;

  // Fallback: parse from headline string when position entities are absent.
  // Covers patterns like:
  //   "Cofounder, Wavelength"       → title="Cofounder",        company="Wavelength"
  //   "Software Engineer at Google" → title="Software Engineer", company="Google"
  //   "CEO | Acme Corp"             → title="CEO",               company="Acme Corp"
  if ((!company || !title) && profileEntity?.headline) {
    const headline: string = profileEntity.headline.trim();
    const atMatch    = headline.match(/^(.+?)\s+at\s+(.+)$/i);
    const pipeMatch  = headline.match(/^(.+?)\s*[|]\s*(.+)$/);
    const commaMatch = headline.match(/^(.+?),\s*(.+)$/);

    if (atMatch) {
      title   = title   ?? atMatch[1].trim();
      company = company ?? atMatch[2].trim();
    } else if (pipeMatch) {
      title   = title   ?? pipeMatch[1].trim();
      company = company ?? pipeMatch[2].trim();
    } else if (commaMatch) {
      title   = title   ?? commaMatch[1].trim();
      company = company ?? commaMatch[2].trim();
    }
  }

  return {
    provider_id: profileUrn ?? null,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    headline: profileEntity?.headline ?? null,
    location,
    profile_pic_url: profilePicUrl,
    public_profile_url: vanityName
      ? `https://www.linkedin.com/in/${vanityName}/`
      : null,
    company,
    title,
  };
}

// ─── Session Bootstrap ────────────────────────────────────────────────────────

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
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`LinkedIn returned HTTP ${response.status}. The li_at token may be invalid or expired.`);
  }

  const setCookies: string[] =
    typeof (response.headers as any).getSetCookie === 'function'
      ? (response.headers as any).getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];

  for (const cookie of setCookies) {
    const match = cookie.match(/JSESSIONID=["']?(ajax:[^"';\s]+)["']?/);
    if (match?.[1]) return match[1];
  }

  throw new Error('JSESSIONID not found in LinkedIn response. Check if li_at is still valid.');
}

export async function getOwnProfile(
  liAt: string,
  jsessionid: string
): Promise<{ profileUrn: string; vanityName: string; firstName: string; lastName: string }> {
  const meRes = await fetch(`${VOYAGER}/me`, {
    headers: {
      ...buildHeaders(jsessionid),
      'Cookie': `li_at=${liAt}; JSESSIONID="${jsessionid}"`,
      'Accept': 'application/vnd.linkedin.normalized+json+2.1',
    },
  });

  if (!meRes.ok) throw new Error(`GET /me failed: HTTP ${meRes.status}`);

  const meData = await meRes.json();
  const included = meData?.included || [];
  const miniProfile = included.find(
    (item: any) => item['$type'] === 'com.linkedin.voyager.identity.shared.MiniProfile'
  );

  if (!miniProfile) {
    throw new Error('Could not find MiniProfile in the LinkedIn response included array.');
  }

  const profileUrn = miniProfile.dashEntityUrn;
  const vanityName = miniProfile.publicIdentifier;
  const firstName = miniProfile.firstName || '';
  const lastName = miniProfile.lastName || '';

  if (!profileUrn || !vanityName) {
    throw new Error('Required profile identifiers (URN or Vanity Name) are missing from the response.');
  }

  return { profileUrn, vanityName, firstName, lastName };
}

// ─── LinkedIn Client ──────────────────────────────────────────────────────────

type OnSessionRefresh = (newJsessionid: string) => Promise<void>;

export class LinkedInClient {
  private liAt: string;
  private jsessionid: string;
  private profileUrn: string;
  private onSessionRefresh: OnSessionRefresh | null;

  constructor(
    liAt: string,
    jsessionid: string,
    profileUrn: string,
    onSessionRefresh: OnSessionRefresh | null = null
  ) {
    this.liAt = liAt;
    this.jsessionid = jsessionid.replace(/"/g, '');
    this.profileUrn = profileUrn;
    this.onSessionRefresh = onSessionRefresh;
  }

  private get cookie(): string {
    return buildCookie(this.liAt, this.jsessionid);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...buildHeaders(this.jsessionid, extra), Cookie: this.cookie };
  }

  private async fetchWithSessionRefresh(makeRequest: () => Promise<Response>): Promise<Response> {
    let response = await makeRequest();
    if ((response.status === 401 || response.status === 403) && await this.tryRefreshSession()) {
      response = await makeRequest();
    }
    return response;
  }

  private async parseErrorFromResponse(response: Response): Promise<ParsedError> {
    const bodyText = await response.text().catch(() => '');
    return parseLinkedInError(response.status, bodyText);
  }

  private async tryRefreshSession(): Promise<boolean> {
    try {
      this.jsessionid = await bootstrapSession(this.liAt);
      this.jsessionid = this.jsessionid.replace(/"/g, '');
      if (this.onSessionRefresh) await this.onSessionRefresh(this.jsessionid);
      return true;
    } catch {
      return false;
    }
  }

  // ── resolveGeoLocation ──────────────────────────────────────────────────────

  /**
   * Resolves a geo URN (urn:li:fsd_geo:XXXXXXX) to a human-readable location string.
   * Called when the geo entity is not present in the profile's included array.
   *
   * Endpoint: GET /voyager/api/typeahead/dash/geo?q=node&ids=List(urn:li:fsd_geo:XXXXX)
   * Returns: { elements: [{ id, name, ... }] }
   */
  private async resolveGeoLocation(geoUrn: string): Promise<string | null> {
    try {
      const encodedUrn = encodeURIComponent(geoUrn);
      const url = `${VOYAGER}/typeahead/dash/geo?q=node&ids=List(${encodedUrn})`;

      const res = await this.fetchWithSessionRefresh(() =>
        fetch(url, { headers: this.headers() })
      );

      if (!res.ok) return null;

      const data = await res.json();

      // Response shape: { elements: [{ entityUrn, defaultLocalizedName, ... }] }
      // Also check included array as LinkedIn sometimes returns it there
      const elements: any[] = data?.elements ?? data?.included ?? [];
      const geo = elements.find(
        (e: any) => e.entityUrn === geoUrn || e['$id'] === geoUrn
      ) ?? elements[0];

      return geo?.defaultLocalizedName ?? geo?.name ?? null;
    } catch {
      return null;
    }
  }

  // ── resolveExperienceCard ───────────────────────────────────────────────────

  /**
   * Resolves the *experienceCard URN pointer to get the current company + title.
   * Called when position entities are absent from the profile's included array.
   *
   * Endpoint: GET /voyager/api/identity/dash/profileCards
   *   ?q=profileCard
   *   &profileCardUrn=<experienceCardUrn>
   *   &decorationId=com.linkedin.voyager.dash.deco.web.profilecard.WebExperienceSummaryProfileCard-14
   *
   * The response includes fsd_profilePosition entities in the included array,
   * each with: title, companyName, timePeriod (no end = current role).
   */
  private async resolveExperienceCard(
    experienceCardUrn: string
  ): Promise<{ company: string | null; title: string | null }> {
    try {
      const encodedUrn = encodeURIComponent(experienceCardUrn);
      const decorationId =
        'com.linkedin.voyager.dash.deco.web.profilecard.WebExperienceSummaryProfileCard-14';
      const url =
        `${VOYAGER}/identity/dash/profileCards` +
        `?q=profileCard` +
        `&profileCardUrn=${encodedUrn}` +
        `&decorationId=${decorationId}`;

      const res = await this.fetchWithSessionRefresh(() =>
        fetch(url, { headers: this.headers() })
      );

      if (!res.ok) return { company: null, title: null };

      const data = await res.json();
      const included: any[] = data?.included ?? data?.elements ?? [];

      // Find position entities — prefer one with no end date (currently active)
      const positions = included.filter(
        (e: any) =>
          typeof e?.entityUrn === 'string' &&
          e.entityUrn.includes('fsd_profilePosition')
      );

      const current =
        positions.find((p: any) => !p.timePeriod?.end && !p.dateRange?.end) ??
        positions[0] ??
        null;

      if (!current) return { company: null, title: null };

      return {
        company: current.companyName ?? current.company?.name ?? null,
        title: current.title ?? null,
      };
    } catch {
      return { company: null, title: null };
    }
  }

  // ── getProfile ──────────────────────────────────────────────────────────────

  /**
   * Fetches a LinkedIn profile by URL or bare vanity name.
   *
   * After the primary GraphQL fetch, two pointer-resolution calls are made
   * in parallel when needed:
   *   1. *experienceCard  → resolves current company + title
   *   2. *geo URN         → resolves human-readable location string
   *
   * Both secondary calls are best-effort — a failure won't block the return.
   */
  async getProfile(linkedinUrl: string): Promise<LinkedInResponse> {
    const vanityName = extractLinkedInIdentifier(linkedinUrl);
    const url = `${VOYAGER}/graphql?variables=(vanityName:${vanityName})&queryId=${PROFILE_QUERY_ID}`;

    const res = await this.fetchWithSessionRefresh(() => fetch(url, { headers: this.headers() }));

    if (!res.ok) {
      const { code, message } = await this.parseErrorFromResponse(res);
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
        (e: any) =>
          isProfileEntity(e) &&
          typeof e?.publicIdentifier === 'string' &&
          e.publicIdentifier.toLowerCase() === normalizedVanity
      ) ??
      included.find(
        (e: any) =>
          isProfileEntity(e) &&
          typeof e?.publicIdentifier === 'string' &&
          e.publicIdentifier.toLowerCase().includes(normalizedVanity)
      ) ??
      included.find(
        (e: any) => isProfileEntity(e) && e.entityUrn !== this.profileUrn
      ) ??
      included.find(
        (e: any) => isProfileEntity(e)
      );

    if (!entity) {
      return { success: false, error: 'unknown_error', message: 'Profile not found in response' };
    }

    // ── Extract base profile data (may have null company/location) ────────────
    let profileData = extractLeadProfile(entity, included);

    // ── Parallel pointer resolution for missing fields ────────────────────────
    // Only fire secondary calls for the fields that are still null after
    // extractLeadProfile() — avoids unnecessary requests.
    const needsCompany  = !profileData.company || !profileData.title;
    const needsLocation = !profileData.location;

    const experienceCardUrn: string | null = entity?.['*experienceCard'] ?? null;
    const geoUrn: string | null            = entity?.geoLocation?.['*geo'] ?? null;

    const [experienceResult, resolvedLocation] = await Promise.all([
      // Only resolve experience card if company/title missing AND we have the URN
      needsCompany && experienceCardUrn
        ? this.resolveExperienceCard(experienceCardUrn)
        : Promise.resolve(null),

      // Only resolve geo if location missing AND we have the URN
      needsLocation && geoUrn
        ? this.resolveGeoLocation(geoUrn)
        : Promise.resolve(null),
    ]);

    // Merge resolved values — only overwrite if still null (don't clobber
    // values that extractLeadProfile already found from included entities)
    if (experienceResult) {
      profileData = {
        ...profileData,
        company: profileData.company ?? experienceResult.company,
        title:   profileData.title   ?? experienceResult.title,
      };
    }

    if (resolvedLocation) {
      profileData = {
        ...profileData,
        location: profileData.location ?? resolvedLocation,
      };
    }

    return {
      success: true,
      data: entity,
      included,
      profileData,
    };
  }

  // ── sendConnectionRequest ───────────────────────────────────────────────────

  async sendConnectionRequest(params: {
    linkedin_url: string;
    message?: string | null;
  }): Promise<LinkedInResponse> {
    const profileResult = await this.getProfile(params.linkedin_url);

    if (!profileResult.success || !profileResult.data) {
      return {
        success: false,
        error: profileResult.error ?? 'unknown_error',
        message: profileResult.message,
      };
    }

    const profile = profileResult.data as any;
    const included = profileResult.included ?? [];
    const targetUrn: string | null = profile?.entityUrn ?? null;
    const profileData = profileResult.profileData;

    if (!targetUrn) {
      return { success: false, error: 'unknown_error', message: 'Could not resolve profile URN', profileData };
    }

    const relationship = included.find(
      (i: any) => i.$type === 'com.linkedin.voyager.dash.relationships.MemberRelationship'
    );

    if (relationship?.distance?.value === 'DISTANCE_1') {
      return {
        success: false,
        alreadyConnected: true,
        error: 'already_connected',
        message: 'Already a 1st-degree connection',
        profileData,
      };
    }

    if (params.message && params.message.length > 300) {
      return {
        success: false,
        error: 'note_too_long',
        message: `Note is ${params.message.length} chars — LinkedIn limit is 300`,
        profileData,
      };
    }

    const body: Record<string, unknown> = {
      invitee: {
        inviteeUnion: {
          memberProfile: targetUrn,
        },
      },
    };

    if (params.message) {
      body.customMessage = params.message;
    }

    const url = `${VOYAGER}/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2`;

    const res = await this.fetchWithSessionRefresh(() =>
      fetch(url, {
        method: 'POST',
        headers: this.headers({
          'content-type': 'application/json; charset=UTF-8',
          'accept': 'application/vnd.linkedin.normalized+json+2.1',
        }),
        body: JSON.stringify(body),
      })
    );

    if (!res.ok) {
      const { code, message } = await this.parseErrorFromResponse(res);
      if (code === 'already_invited') {
        return { success: false, alreadyInvited: true, error: code, message, profileData };
      }
      return { success: false, error: code, message, profileData };
    }

    return { success: true, data: await res.json(), profileData };
  }

  // ── sendMessage ─────────────────────────────────────────────────────────────

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

    if (!recipientUrn) {
      return { success: false, error: 'unknown_error', message: 'Could not resolve recipient URN' };
    }

    const url = `${VOYAGER}/voyagerMessagingDashMessengerMessages?action=createMessage`;
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

    const res = await this.fetchWithSessionRefresh(() =>
      fetch(url, {
        method: 'POST',
        headers: this.headers(extraHeaders),
        body: JSON.stringify(body),
      })
    );

    if (!res.ok) {
      const { code, message } = await this.parseErrorFromResponse(res);
      return { success: false, error: code, message };
    }

    return { success: true, data: await res.json() };
  }

  // ── fetchConversationsByIds ─────────────────────────────────────────────────

  async fetchConversationsByIds(conversationUrns: string[]): Promise<LinkedInResponse> {
    if (!conversationUrns.length) {
      return { success: true, data: {} };
    }

    const idsExpr = `List(${conversationUrns.join(',')})`;
    const url = `${VOYAGER}/voyagerMessagingDashMessengerConversations?ids=${encodeURIComponent(idsExpr)}`;

    const res = await this.fetchWithSessionRefresh(() =>
      fetch(url, {
        method: 'GET',
        headers: this.headers({
          accept: 'application/json',
          'content-type': 'text/plain;charset=UTF-8',
        }),
      })
    );

    if (!res.ok) {
      const { code, message } = await this.parseErrorFromResponse(res);
      return { success: false, error: code, message };
    }

    return { success: true, data: await res.json() };
  }

  // ── fetchMailboxConversations ───────────────────────────────────────────────

  async fetchMailboxConversations(_params?: { start?: number; count?: number; syncToken?: string }): Promise<LinkedInResponse> {
    const mailboxUrn = (this.profileUrn || '').trim();
    if (!mailboxUrn) {
      return { success: false, error: 'unknown_error', message: 'Missing mailbox URN' };
    }

    const workingVariables = `(mailboxUrn:${encodeURIComponent(mailboxUrn)})`;
    const url = `${VOYAGER}/voyagerMessagingGraphQL/graphql?queryId=${HARDCODED_MESSENGER_CONVERSATIONS_QUERY_ID}&variables=${workingVariables}`;

    try {
      const res = await this.fetchWithSessionRefresh(() =>
        fetch(url, {
          method: 'GET',
          headers: {
            'accept': 'application/graphql',
            'accept-language': 'en-US,en;q=0.8',
            'cache-control': 'no-cache',
            'x-restli-protocol-version': '2.0.0',
            'csrf-token': this.jsessionid,
            'cookie': buildCookie(this.liAt, this.jsessionid),
          },
        })
      );

      if (res.ok) return { success: true, data: await res.json() };

      const parsed = await this.parseErrorFromResponse(res);
      return { success: false, error: parsed.code, message: parsed.message };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Mailbox request failed';
      return { success: false, error: 'network_error', message };
    }
  }

  // ── fetchConversationMessages ───────────────────────────────────────────────

  async fetchConversationMessages(
    conversationUrn: string,
    params?: { syncToken?: string }
  ): Promise<LinkedInResponse> {
    const encodedUrn = strictEncode(conversationUrn);
    const variablesString = params?.syncToken
      ? `(conversationUrn:${encodedUrn},syncToken:${strictEncode(params.syncToken)})`
      : `(conversationUrn:${encodedUrn})`;

    const url = `${VOYAGER}/voyagerMessagingGraphQL/graphql?queryId=${MESSENGER_MESSAGES_QUERY_ID}&variables=${variablesString}`;

    const threadIdMatch = conversationUrn.match(/,([^,)]+)\)$/);
    const threadId = threadIdMatch
      ? threadIdMatch[1]
      : conversationUrn.replace(/.*[:,]/, '').replace(/\)$/, '');
    const refererUrl = threadId
      ? `https://www.linkedin.com/messaging/thread/${threadId}/`
      : 'https://www.linkedin.com/messaging/';

    try {
      const res = await this.fetchWithSessionRefresh(() =>
        fetch(url, {
          method: 'GET',
          headers: {
            'accept': 'application/graphql',
            'accept-language': 'en-US,en;q=0.8',
            'cache-control': 'no-cache',
            'x-restli-protocol-version': '2.0.0',
            'referer': refererUrl,
            'csrf-token': this.jsessionid,
            'cookie': buildCookie(this.liAt, this.jsessionid),
          },
        })
      );

      if (res.ok) return { success: true, data: await res.json() };

      const parsed = await this.parseErrorFromResponse(res);
      return { success: false, error: parsed.code, message: parsed.message };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Messages request failed';
      return { success: false, error: 'network_error', message };
    }
  }

  // ── extractConversationUrn / extractMessageUrn ──────────────────────────────

  extractConversationUrn(payload: unknown): string | null {
    return findStringByPrefix(payload, 'urn:li:msg_conversation:');
  }

  extractMessageUrn(payload: unknown): string | null {
    return findStringByPrefix(payload, 'urn:li:msg_message:');
  }

  // ── getRecentConnections ────────────────────────────────────────────────────

  async getRecentConnections(): Promise<LinkedInResponse> {
    const url = `${VOYAGER}/relationships/dash/connections?decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16&count=40&q=search&sortType=RECENTLY_ADDED`;

    const res = await this.fetchWithSessionRefresh(() =>
      fetch(url, {
        headers: this.headers({ 'x-li-deco-include-micro-schema': 'true' }),
      })
    );

    if (!res.ok) {
      const { code, message } = await this.parseErrorFromResponse(res);
      return { success: false, error: code, message };
    }

    return { success: true, data: await res.json() };
  }

  // ── uuidToBytes ─────────────────────────────────────────────────────────────

  private uuidToBytes(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    let binary = '';
    for (let i = 0; i < hex.length; i += 2) {
      binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return binary;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

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