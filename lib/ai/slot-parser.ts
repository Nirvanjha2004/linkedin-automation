import type { TimeSlot } from '@/types';

export type SlotParseResult =
  | { type: 'selected'; slot: TimeSlot }
  | { type: 'ambiguous' }
  | { type: 'none' };

/**
 * Ordinal patterns that clearly indicate a slot selection.
 * Each entry maps to a zero-based slot index.
 */
const ORDINAL_PATTERNS: Array<{ index: number; patterns: RegExp[] }> = [
  {
    index: 0,
    patterns: [
      /\b(the\s+)?first\s+(one|option|slot|time|choice)?\b/i,
      /\b(option|number|slot|choice)\s*[#]?\s*1\b/i,
      /\b1st\b/i,
      /\bi'?ll?\s+(take|go\s+with|choose|pick)\s+(the\s+)?first\b/i,
      /\bfirst\s+(works?|is\s+(good|great|fine|perfect))\b/i,
    ],
  },
  {
    index: 1,
    patterns: [
      /\b(the\s+)?second\s+(one|option|slot|time|choice)?\b/i,
      /\b(option|number|slot|choice)\s*[#]?\s*2\b/i,
      /\b2nd\b/i,
      /\bi'?ll?\s+(take|go\s+with|choose|pick)\s+(the\s+)?second\b/i,
      /\bsecond\s+(works?|is\s+(good|great|fine|perfect))\b/i,
    ],
  },
  {
    index: 2,
    patterns: [
      /\b(the\s+)?third\s+(one|option|slot|time|choice)?\b/i,
      /\b(option|number|slot|choice)\s*[#]?\s*3\b/i,
      /\b3rd\b/i,
      /\bi'?ll?\s+(take|go\s+with|choose|pick)\s+(the\s+)?third\b/i,
      /\bthird\s+(works?|is\s+(good|great|fine|perfect))\b/i,
    ],
  },
];

/**
 * Extract time patterns from a slot label (e.g. "2:00 PM", "14:00").
 */
function extractTimePatterns(label: string): string[] {
  const patterns: string[] = [];
  // Match "2:00 PM", "14:30", "9:00 AM", etc.
  const timeRegex = /\b(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = timeRegex.exec(label)) !== null) {
    patterns.push(match[1].trim());
  }
  return patterns;
}

/**
 * Extract date patterns from a slot label (e.g. "Tuesday", "14 Jan", "January 14").
 */
function extractDatePatterns(label: string): string[] {
  const patterns: string[] = [];

  // Day names
  const dayRegex = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = dayRegex.exec(label)) !== null) {
    patterns.push(match[1]);
  }

  // "14 Jan", "14 January"
  const dayMonthRegex = /\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?))\b/gi;
  while ((match = dayMonthRegex.exec(label)) !== null) {
    patterns.push(match[1]);
  }

  // "Jan 14", "January 14"
  const monthDayRegex = /\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2})\b/gi;
  while ((match = monthDayRegex.exec(label)) !== null) {
    patterns.push(match[1]);
  }

  return patterns;
}

/**
 * Check if a slot's label content appears in the lead message (case-insensitive).
 */
function slotMatchesByContent(message: string, slot: TimeSlot): boolean {
  const lowerMessage = message.toLowerCase();

  const timePatterns = extractTimePatterns(slot.label);
  for (const pattern of timePatterns) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  const datePatterns = extractDatePatterns(slot.label);
  for (const pattern of datePatterns) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Parses a lead's free-text reply to identify which proposed slot they selected.
 *
 * Matching strategy (in order):
 * 1. Ordinal matching — "first", "1st", "option 1", etc.
 * 2. Time string matching — "2:00 PM" appears in the message
 * 3. Date string matching — "Tuesday", "14 Jan" appears in the message
 *
 * Returns:
 * - `{ type: 'selected', slot }` for exactly one match
 * - `{ type: 'ambiguous' }` for multiple matches
 * - `{ type: 'none' }` for no match
 */
export function parseSlotSelection(
  leadMessage: string,
  proposedSlots: TimeSlot[]
): SlotParseResult {
  if (proposedSlots.length === 0) {
    return { type: 'none' };
  }

  const matchedIndices = new Set<number>();

  // 1. Ordinal matching
  for (const { index, patterns } of ORDINAL_PATTERNS) {
    if (index >= proposedSlots.length) continue;
    for (const pattern of patterns) {
      if (pattern.test(leadMessage)) {
        matchedIndices.add(index);
        break;
      }
    }
  }

  // 2 & 3. Content matching (time + date strings from label)
  for (let i = 0; i < proposedSlots.length; i++) {
    if (slotMatchesByContent(leadMessage, proposedSlots[i])) {
      matchedIndices.add(i);
    }
  }

  if (matchedIndices.size === 0) {
    return { type: 'none' };
  }

  if (matchedIndices.size > 1) {
    return { type: 'ambiguous' };
  }

  const [index] = matchedIndices;
  return { type: 'selected', slot: proposedSlots[index] };
}
