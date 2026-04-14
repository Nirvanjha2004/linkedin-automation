import type { TimeSlot } from '@/types';

// ── Internal token refresh ────────────────────────────────────────────────────

/**
 * Exchanges a stored OAuth refresh token for a short-lived access token.
 * The access token is returned in memory only and never persisted.
 *
 * Requirement 6.1: The Google Calendar client uses the stored OAuth refresh
 * token to obtain a valid access token before each API call.
 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${error}`);
  }

  const data = await response.json() as { access_token?: string };

  if (!data.access_token) {
    throw new Error('Token refresh response missing access_token');
  }

  return data.access_token;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Converts a local date/time (expressed as a YYYY-MM-DD date string plus
 * hours/minutes in the given IANA timezone) to a UTC millisecond timestamp.
 */
function localToUtcMs(dateStr: string, hours: number, minutes: number, timezone: string): number {
  // Build an ISO-like string and parse it, then correct for the timezone offset
  // by formatting the same instant in the target timezone and computing the delta.
  const naiveMs = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`).getTime();

  // Use Intl to find what UTC time corresponds to the local time in `timezone`
  // by binary-searching for the offset. A simpler approach: format a known UTC
  // instant in the target timezone and compute the offset.
  const probe = new Date(naiveMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(probe);

  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const localYear = get('year');
  const localMonth = get('month') - 1;
  const localDay = get('day');
  const localHour = get('hour') === 24 ? 0 : get('hour');
  const localMinute = get('minute');
  const localSecond = get('second');

  // Difference between what the probe UTC instant looks like in the timezone
  // vs. what we actually want
  const probeLocalMs = Date.UTC(localYear, localMonth, localDay, localHour, localMinute, localSecond);
  const offset = naiveMs - probeLocalMs; // timezone offset in ms (UTC = local + offset)

  return naiveMs + offset;
}

/**
 * Formats a UTC Date as a human-readable slot label in the given timezone.
 * Example: "Tuesday 14 Jan at 2:00 PM"
 */
function formatSlotLabel(date: Date, timezone: string): string {
  const weekday = date.toLocaleDateString('en-GB', { timeZone: timezone, weekday: 'long' });
  const day = date.toLocaleDateString('en-GB', { timeZone: timezone, day: 'numeric' });
  const month = date.toLocaleDateString('en-GB', { timeZone: timezone, month: 'short' });
  const time = date.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true });
  return `${weekday} ${day} ${month} at ${time}`;
}

// ── Google Calendar Client ────────────────────────────────────────────────────

export interface GetAvailableSlotsParams {
  refreshToken: string;
  durationMinutes: number;
  timezone: string;
  daysAhead?: number; // default 7
}

export interface CreateEventParams {
  refreshToken: string;
  title: string;
  description: string;
  slot: TimeSlot;
  organizerEmail: string;
}

export interface CreateEventResult {
  eventId: string;
  htmlLink: string;
}

export const googleCalendarClient = {
  /**
   * Returns available time slots from the user's primary Google Calendar.
   *
   * Requirements 6.2, 6.3:
   * - Queries free/busy over the next 7 days
   * - Returns slots of exactly durationMinutes within 08:00–18:00 in the configured timezone
   * - Slots are generated at 30-minute intervals and sorted by start time
   */
  async getAvailableSlots(params: GetAvailableSlotsParams): Promise<TimeSlot[]> {
    const { refreshToken, durationMinutes, timezone, daysAhead = 7 } = params;

    const accessToken = await refreshAccessToken(refreshToken);

    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

    const freeBusyResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/freeBusy',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          timeZone: timezone,
          items: [{ id: 'primary' }],
        }),
      }
    );

    if (!freeBusyResponse.ok) {
      const error = await freeBusyResponse.text();
      throw new Error(`Free/busy query failed (${freeBusyResponse.status}): ${error}`);
    }

    const freeBusyData = await freeBusyResponse.json() as {
      calendars?: {
        primary?: {
          busy?: Array<{ start: string; end: string }>;
        };
      };
    };

    const busyPeriods = (freeBusyData.calendars?.primary?.busy ?? []).map(
      (b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() })
    );

    const slots: TimeSlot[] = [];
    const slotDurationMs = durationMinutes * 60 * 1000;

    // Iterate through each day in the window
    for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
      const dayStart = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);

      // Build 08:00 and 18:00 boundaries in the configured timezone
      const dateStr = dayStart.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD

      // Convert timezone-local boundaries to UTC ms using Intl
      const windowStartMs = localToUtcMs(dateStr, 8, 0, timezone);
      const windowEndMs = localToUtcMs(dateStr, 18, 0, timezone);

      // Generate candidate slots at 30-minute intervals
      const intervalMs = 30 * 60 * 1000;
      let candidateStart = windowStartMs;

      while (candidateStart + slotDurationMs <= windowEndMs) {
        const candidateEnd = candidateStart + slotDurationMs;

        // Skip slots that start in the past
        if (candidateStart > now.getTime()) {
          const overlaps = busyPeriods.some(
            (busy) => candidateStart < busy.end && candidateEnd > busy.start
          );

          if (!overlaps) {
            const startDate = new Date(candidateStart);
            const endDate = new Date(candidateEnd);
            slots.push({
              start: startDate.toISOString(),
              end: endDate.toISOString(),
              label: formatSlotLabel(startDate, timezone),
            });
          }
        }

        candidateStart += intervalMs;
      }
    }

    return slots.sort((a, b) => a.start.localeCompare(b.start));
  },

  /**
   * Creates a calendar event for the selected meeting slot.
   *
   * Requirement 7.2: Creates an event with the meeting title, lead name and
   * LinkedIn URL in the description, start/end from the selected slot, and
   * the user as the event organiser.
   */
  async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
    const { refreshToken, title, description, slot, organizerEmail } = params;

    const accessToken = await refreshAccessToken(refreshToken);

    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          summary: title,
          description,
          start: { dateTime: slot.start, timeZone: 'UTC' },
          end: { dateTime: slot.end, timeZone: 'UTC' },
          organizer: { email: organizerEmail },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Calendar event creation failed (${response.status}): ${error}`);
    }

    const data = await response.json() as { id?: string; htmlLink?: string };

    if (!data.id || !data.htmlLink) {
      throw new Error('Calendar event creation response missing id or htmlLink');
    }

    return { eventId: data.id, htmlLink: data.htmlLink };
  },
};

// Export the internal helper for testing purposes
export { refreshAccessToken };
