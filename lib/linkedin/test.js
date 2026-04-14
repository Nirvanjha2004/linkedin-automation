import fetch from 'node-fetch';

// ─── YOUR CREDENTIALS (replace these) ───────────────────────────────────────
// To get these: open LinkedIn in Chrome → F12 → Application → Cookies → linkedin.com
const CREDENTIALS = {
  li_at: 'AQEDAUSxiWACcNc8AAABnYuyJg4AAAGdr76qDk4AcqesAyIdaYreCaHitJU8nHT-bFLPks3m0MbOlU3_JQW5Lv_LTzMxcxR6Ab8tjDWa4e2yzm8EM-bG3yXB_018v0VGlDU7QO8x3NlrqdL80tHaTO-J',         // Main auth token — most important
  JSESSIONID: 'ajax:1147937095872345794', // Must match csrf-token below
  bcookie: '"v=2&bdc9b988-56ff-46fa-8791-f8cb9d1d585d"',
  bscookie: '"v=1&2026041410110949fa0ba8-5a55-4aa4-8d73-81f4d9c17a9cAQEXykHyxwNwNkzEKIKVfB_HOFLusO6e"',
};
// ────────────────────────────────────────────────────────────────────────────

const VOYAGER = 'https://www.linkedin.com/voyager/api';
const PROFILE_QUERY_ID = 'voyagerIdentityDashProfiles.34ead06db82a2cc9a778fac97f69ad6a';

function extractLinkedInIdentifier(url) {
  return url.split('/in/')[1]?.replace(/\/$/, ''); // also strips trailing slash
}

async function getProfile(linkedinUrl) {
  const vanityName = extractLinkedInIdentifier(linkedinUrl);

  if (!vanityName) {
    return { success: false, message: 'Invalid LinkedIn URL' };
  }

  const url = `${VOYAGER}/graphql?variables=(vanityName:${vanityName})&queryId=${PROFILE_QUERY_ID}`;

  const csrfToken = CREDENTIALS.JSESSIONID; // They must match

  const cookie = [
    'lang=v=2&lang=en-us',
    `bcookie=${CREDENTIALS.bcookie}`,
    `bscookie=${CREDENTIALS.bscookie}`,
    `li_at=${CREDENTIALS.li_at}`,
    `JSESSIONID=${CREDENTIALS.JSESSIONID}`,
  ].join('; ');

  const res = await fetch(url, {
    method: 'GET',
    redirect: 'manual', // ← KEY FIX: don't follow redirects silently
    headers: {
      accept: 'application/vnd.linkedin.normalized+json+2.1',
      'accept-language': 'en-US,en;q=0.7',
      'csrf-token': csrfToken,
      'x-li-lang': 'en_US',
      'x-restli-protocol-version': '2.0.0',
      'x-li-track': '{"clientVersion":"1.13.17265","mpVersion":"1.13.17265","osName":"web","timezoneOffset":5.5,"timezone":"Asia/Calcutta","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      referer: `https://www.linkedin.com/in/${vanityName}/`,
      cookie,
    },
  });

  // Redirect = auth failure (expired/missing li_at)
  if (res.status === 302 || res.status === 301) {
    return {
      success: false,
      error: 'AUTH_REDIRECT',
      message: 'LinkedIn redirected — your li_at cookie is missing or expired. Grab a fresh one from browser DevTools.',
      redirectTo: res.headers.get('location'),
    };
  }

  if (res.status === 403) {
    return {
      success: false,
      error: 'FORBIDDEN',
      message: 'CSRF token mismatch or rate-limited. Make sure JSESSIONID and csrf-token match.',
    };
  }

  if (!res.ok) {
    return {
      success: false,
      error: res.status,
      message: await res.text(),
    };
  }

  const data = await res.json();
  const included = data?.included ?? [];

  const entity =
    included.find(
      (e) =>
        e?.entityUrn?.startsWith('urn:li:fsd_profile:') &&
        e?.publicIdentifier?.toLowerCase() === vanityName.toLowerCase()
    ) || included.find((e) => e?.entityUrn?.startsWith('urn:li:fsd_profile:'));

  if (!entity) {
    return {
      success: false,
      message: 'Profile entity not found in response',
      includedCount: included.length,
      raw: data,
    };
  }

  return {
    success: true,
    data: entity,
  };
}

// 🚀 RUN
(async () => {
  const result = await getProfile('https://www.linkedin.com/in/ishaangupta22/');
  console.log(JSON.stringify(result, null, 2));
})();