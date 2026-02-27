import { CampaignSchedule, TimeWindow } from '@/types';

/**
 * Parses "HH:MM" string to minutes since midnight.
 */
function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Gets current time in minutes since midnight for a given timezone.
 */
function getCurrentMinutesInTimezone(timezone: string): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  });
  
  const parts = formatter.formatToParts(now);
  const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  return hours * 60 + minutes;
}

/**
 * Gets current day of week (0=Sunday) in a given timezone.
 */
function getCurrentDayOfWeekInTimezone(timezone: string): number {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: timezone })).getDay();
}

/**
 * Checks if the current time is within a specific time window.
 */
function isInTimeWindow(window: TimeWindow, currentMinutes: number): boolean {
  const startMinutes = parseTimeToMinutes(window.start_time);
  const endMinutes = parseTimeToMinutes(window.end_time);
  
  // Handle overnight windows (e.g., 22:00 - 02:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Checks if a campaign is currently within its operational window.
 */
export function isWithinOperationalWindow(schedule: CampaignSchedule): boolean {
  const timezone = schedule.timezone || 'UTC';
  const currentDayOfWeek = getCurrentDayOfWeekInTimezone(timezone);
  const currentMinutes = getCurrentMinutesInTimezone(timezone);

  // Check if today is an operational day
  if (!schedule.days_of_week.includes(currentDayOfWeek)) {
    return false;
  }

  // Check if current time is within any operational window
  return schedule.time_windows.some(window => isInTimeWindow(window, currentMinutes));
}

/**
 * Gets remaining minutes in the current operational window.
 * Returns 0 if not in window, or the minutes until window ends.
 */
export function getRemainingWindowMinutes(schedule: CampaignSchedule): number {
  const timezone = schedule.timezone || 'UTC';
  const currentMinutes = getCurrentMinutesInTimezone(timezone);

  for (const window of schedule.time_windows) {
    if (isInTimeWindow(window, currentMinutes)) {
      const endMinutes = parseTimeToMinutes(window.end_time);
      if (endMinutes > currentMinutes) {
        return endMinutes - currentMinutes;
      }
      // Overnight window
      return (24 * 60 - currentMinutes) + endMinutes;
    }
  }

  return 0;
}

/**
 * Calculates minutes until the next operational window starts.
 */
export function getMinutesUntilNextWindow(schedule: CampaignSchedule): number {
  const timezone = schedule.timezone || 'UTC';
  const currentDayOfWeek = getCurrentDayOfWeekInTimezone(timezone);
  const currentMinutes = getCurrentMinutesInTimezone(timezone);

  let minWait = Infinity;

  // Check next 7 days
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const checkDay = (currentDayOfWeek + dayOffset) % 7;
    
    if (!schedule.days_of_week.includes(checkDay)) continue;

    for (const window of schedule.time_windows) {
      const startMinutes = parseTimeToMinutes(window.start_time);
      const waitMinutes = dayOffset * 24 * 60 + (startMinutes - currentMinutes);
      
      if (waitMinutes > 0 && waitMinutes < minWait) {
        minWait = waitMinutes;
      }
    }
  }

  return minWait === Infinity ? 0 : minWait;
}

/**
 * Calculates optimal task distribution across remaining window time.
 * Returns number of actions to take now given window constraints.
 */
export function calculateActionsForWindow(
  remainingMinutes: number,
  remainingActions: number,
  actionsPerHour: number = 10
): number {
  const maxInWindow = Math.floor((remainingMinutes / 60) * actionsPerHour);
  // Leave buffer: take at most 80% of max to avoid rushing at end
  const safeMax = Math.floor(maxInWindow * 0.8);
  return Math.min(safeMax, remainingActions, actionsPerHour);
}
