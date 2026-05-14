/**
 * Simulated cold-start cohorts: initial preferences for timing, tone, content, duration.
 * `preferredSlotIds` reference ids from `timeSlots.js`.
 */

export const COHORT_PROFILES = [
  {
    id: 'busy_low_confidence_evening',
    label: 'Busy, low confidence, evening-flex',
    preferredSlotIds: [
      '18:00',
      '18:30',
      '19:00',
      '19:30',
      '20:00',
      '20:30',
      '21:00',
      '21:30',
    ],
    preferredTone: 'gentle',
    preferredContentIds: ['standing_movement', 'ankle_movement'],
    preferredDurationMinutes: 2,
    matchHints: {
      barriers: ['lack_of_time', 'low_motivation'],
      confidence: ['low'],
      timeRanges: ['evening', 'after_dinner'],
    },
  },
  {
    id: 'fatigue_prone',
    label: 'Fatigue-prone',
    preferredSlotIds: [
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
    ],
    preferredTone: 'gentle',
    preferredContentIds: ['ankle_movement', 'standing_movement', 'indoor_walk'],
    preferredDurationMinutes: 2,
    matchHints: {
      barriers: ['fatigue'],
      confidence: ['low', 'medium'],
      timeRanges: ['morning', 'afternoon'],
    },
  },
  {
    id: 'pain_cautious',
    label: 'Pain-cautious',
    preferredSlotIds: [
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '16:00',
      '16:30',
      '17:00',
      '17:30',
    ],
    preferredTone: 'informational',
    preferredContentIds: ['ankle_movement', 'standing_movement', 'indoor_walk'],
    preferredDurationMinutes: 2,
    matchHints: {
      barriers: ['pain'],
      painConcern: true,
      timeRanges: ['morning', 'afternoon', 'evening'],
    },
  },
  {
    id: 'information_responsive',
    label: 'Information-responsive',
    preferredSlotIds: [
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '12:00',
      '12:30',
      '13:00',
      '13:30',
    ],
    preferredTone: 'informational',
    preferredContentIds: ['indoor_walk', 'gentle_stretching', 'after_meal_walk'],
    preferredDurationMinutes: 3,
    matchHints: {
      barriers: ['lack_of_time'],
      confidence: ['medium', 'high'],
      timeRanges: ['morning', 'afternoon'],
    },
  },
  {
    id: 'low_motivation_restart',
    label: 'Low motivation restart',
    preferredSlotIds: [
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '17:00',
      '17:30',
      '18:00',
      '18:30',
    ],
    preferredTone: 'motivational',
    preferredContentIds: ['standing_movement', 'indoor_walk', 'ankle_movement'],
    preferredDurationMinutes: 2,
    matchHints: {
      barriers: ['low_motivation', 'fatigue'],
      confidence: ['low', 'medium'],
      timeRanges: ['morning', 'afternoon', 'evening'],
    },
  },
]

export function getCohortById(id) {
  return COHORT_PROFILES.find((c) => c.id === id) ?? COHORT_PROFILES[0]
}
