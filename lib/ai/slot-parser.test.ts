import { describe, it, expect } from 'vitest';
import { parseSlotSelection } from './slot-parser';
import type { TimeSlot } from '@/types';

const slots: TimeSlot[] = [
  {
    start: '2025-01-14T14:00:00Z',
    end: '2025-01-14T14:30:00Z',
    label: 'Tuesday 14 Jan at 2:00 PM',
  },
  {
    start: '2025-01-15T10:00:00Z',
    end: '2025-01-15T10:30:00Z',
    label: 'Wednesday 15 Jan at 10:00 AM',
  },
  {
    start: '2025-01-16T16:00:00Z',
    end: '2025-01-16T16:30:00Z',
    label: 'Thursday 16 Jan at 4:00 PM',
  },
];

describe('parseSlotSelection', () => {
  describe('empty slots', () => {
    it('returns none when no slots are provided', () => {
      expect(parseSlotSelection('the first one', [])).toEqual({ type: 'none' });
    });
  });

  describe('ordinal matching', () => {
    it('matches "the first one"', () => {
      const result = parseSlotSelection('the first one works for me', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[0] });
    });

    it('matches "the second one"', () => {
      const result = parseSlotSelection("I'll take the second one", slots);
      expect(result).toEqual({ type: 'selected', slot: slots[1] });
    });

    it('matches "the third one"', () => {
      const result = parseSlotSelection('the third one is perfect', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[2] });
    });

    it('matches "option 1"', () => {
      const result = parseSlotSelection('option 1 works', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[0] });
    });

    it('matches "option 2"', () => {
      const result = parseSlotSelection('option 2 please', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[1] });
    });

    it('matches "option 3"', () => {
      const result = parseSlotSelection('option 3 is fine', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[2] });
    });

    it('matches "1st"', () => {
      const result = parseSlotSelection('the 1st slot works', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[0] });
    });

    it('matches "2nd"', () => {
      const result = parseSlotSelection('2nd option please', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[1] });
    });

    it('matches "3rd"', () => {
      const result = parseSlotSelection('3rd works for me', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[2] });
    });

    it('matches "number 2"', () => {
      const result = parseSlotSelection('number 2 is good', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[1] });
    });

    it('matches "I\'ll go with the second"', () => {
      const result = parseSlotSelection("I'll go with the second", slots);
      expect(result).toEqual({ type: 'selected', slot: slots[1] });
    });

    it('does not match bare "1" in a sentence without slot context', () => {
      // "I have 1 question" should not match
      const result = parseSlotSelection('I have 1 question about the meeting', slots);
      expect(result).toEqual({ type: 'none' });
    });

    it('does not match ordinal beyond available slots', () => {
      const twoSlots = slots.slice(0, 2);
      const result = parseSlotSelection('the third one', twoSlots);
      expect(result).toEqual({ type: 'none' });
    });
  });

  describe('time string matching', () => {
    it('matches by exact time "2:00 PM"', () => {
      const result = parseSlotSelection('How about 2:00 PM?', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[0] });
    });

    it('matches by time "10:00 AM"', () => {
      const result = parseSlotSelection('10:00 AM works great', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[1] });
    });

    it('matches case-insensitively for time', () => {
      const result = parseSlotSelection('2:00 pm is fine', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[0] });
    });
  });

  describe('date string matching', () => {
    it('matches by day name "Tuesday"', () => {
      const result = parseSlotSelection('Tuesday works for me', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[0] });
    });

    it('matches by day name "Wednesday"', () => {
      const result = parseSlotSelection('Wednesday is perfect', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[1] });
    });

    it('matches by "14 Jan"', () => {
      const result = parseSlotSelection('14 Jan is good', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[0] });
    });

    it('matches case-insensitively for day names', () => {
      const result = parseSlotSelection('thursday works', slots);
      expect(result).toEqual({ type: 'selected', slot: slots[2] });
    });
  });

  describe('ambiguous matching', () => {
    it('returns ambiguous when two ordinals match different slots', () => {
      const result = parseSlotSelection('the first or second option', slots);
      expect(result).toEqual({ type: 'ambiguous' });
    });

    it('returns ambiguous when two day names match different slots', () => {
      const result = parseSlotSelection('Tuesday or Wednesday works', slots);
      expect(result).toEqual({ type: 'ambiguous' });
    });

    it('returns ambiguous when ordinal and time match different slots', () => {
      // "first" → slot[0], "10:00 AM" → slot[1]
      const result = parseSlotSelection('the first or 10:00 AM', slots);
      expect(result).toEqual({ type: 'ambiguous' });
    });
  });

  describe('no match', () => {
    it('returns none for an unrelated message', () => {
      const result = parseSlotSelection('Sounds great, looking forward to it!', slots);
      expect(result).toEqual({ type: 'none' });
    });

    it('returns none for an empty message', () => {
      const result = parseSlotSelection('', slots);
      expect(result).toEqual({ type: 'none' });
    });

    it('returns none when message mentions a time not in any slot', () => {
      const result = parseSlotSelection('How about 3:00 PM instead?', slots);
      expect(result).toEqual({ type: 'none' });
    });
  });
});
