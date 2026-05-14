import { TIME_SLOT_IDS } from '../data/timeSlots.js'
import { TONES } from '../data/promptTemplates.js'
import { MICRO_ACTION_IDS } from '../data/microActions.js'

export const STORAGE_KEY = 'adaptivePromptEngineV2'

export const PREFERRED_TIME_RANGE_IDS = ['morning', 'afternoon', 'evening', 'after_dinner']

export const MAIN_BARRIER_IDS = [
  'lack_of_time',
  'fatigue',
  'pain',
  'low_motivation',
  'weather',
]

export const TIME_RANGE_LABELS = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  after_dinner: 'after dinner',
}

export const BARRIER_LABELS = {
  lack_of_time: 'lack of time',
  fatigue: 'fatigue',
  pain: 'pain',
  low_motivation: 'low motivation',
  weather: 'weather',
}

/** @typedef {{ mainBarriers: string[], preferredTimeRanges: string[], baselineConfidence: string, painConcern: string, preferredTone: string }} UserProfileV2 */
/** @typedef {{ fatigueToday: number, painToday: number, motivationToday: number, weather: string, availabilityToday: string }} DailyContextV2 */
/** @typedef {{ bySlot: Record<string, { sum: number, count: number }>, byContent: Record<string, { sum: number, count: number }> }} DurationStatsV2 */

/**
 * @typedef {{
 *   userProfile: UserProfileV2,
 *   dailyContext: DailyContextV2,
 *   matchedCohortId: string | null,
 *   cohortMatchScore: number,
 *   timingScores: Record<string, number>,
 *   toneScores: Record<string, number>,
 *   contentScores: Record<string, number>,
 *   durationStats: DurationStatsV2,
 *   feedbackHistory: object[],
 *   lastRecommendation: object | null,
 * }} AppStateV2
 */

const LEGACY_BARRIER_TO_ID = {
  'lack of time': 'lack_of_time',
  fatigue: 'fatigue',
  pain: 'pain',
  'low motivation': 'low_motivation',
  weather: 'weather',
}

/**
 * @param {object} raw
 * @returns {UserProfileV2}
 */
export function migrateUserProfile(raw) {
  const base = defaultUserProfile()
  if (!raw || typeof raw !== 'object') return base

  const { mainBarrier, preferredTimeRange, ...rest } = raw

  let preferredTimeRanges = raw.preferredTimeRanges
  if (!Array.isArray(preferredTimeRanges)) {
    let single = preferredTimeRange
    if (single === 'late') single = 'after_dinner'
    preferredTimeRanges =
      single && PREFERRED_TIME_RANGE_IDS.includes(single) ? [single] : [...base.preferredTimeRanges]
  }
  preferredTimeRanges = preferredTimeRanges.filter((id) => PREFERRED_TIME_RANGE_IDS.includes(id))
  if (preferredTimeRanges.length === 0) preferredTimeRanges = [...base.preferredTimeRanges]

  let mainBarriers = raw.mainBarriers
  if (!Array.isArray(mainBarriers)) {
    const legacy = mainBarrier
    const mapped =
      typeof legacy === 'string' ? LEGACY_BARRIER_TO_ID[legacy] ?? null : null
    mainBarriers = mapped ? [mapped] : [...base.mainBarriers]
  }
  mainBarriers = mainBarriers.filter((id) => MAIN_BARRIER_IDS.includes(id))
  if (mainBarriers.length === 0) mainBarriers = [...base.mainBarriers]

  return {
    ...base,
    ...rest,
    preferredTimeRanges,
    mainBarriers,
  }
}

export function defaultUserProfile() {
  return {
    mainBarriers: ['lack_of_time'],
    preferredTimeRanges: ['evening'],
    baselineConfidence: 'medium',
    painConcern: 'no',
    preferredTone: 'gentle',
  }
}

export function defaultDailyContext() {
  return {
    fatigueToday: 3,
    painToday: 0,
    motivationToday: 3,
    weather: 'not relevant',
    availabilityToday: 'medium',
  }
}

function zeroMap(keys) {
  return Object.fromEntries(keys.map((k) => [k, 0]))
}

export function createInitialAppState() {
  return {
    userProfile: defaultUserProfile(),
    dailyContext: defaultDailyContext(),
    matchedCohortId: null,
    cohortMatchScore: 0,
    timingScores: zeroMap(TIME_SLOT_IDS),
    toneScores: zeroMap(TONES),
    contentScores: zeroMap(MICRO_ACTION_IDS),
    durationStats: { bySlot: {}, byContent: {} },
    feedbackHistory: [],
    lastRecommendation: null,
  }
}

/**
 * @param {Partial<AppStateV2>} loaded
 * @returns {AppStateV2}
 */
export function normalizeAppState(loaded) {
  const base = createInitialAppState()
  if (!loaded || typeof loaded !== 'object') return base

  const timingScores = { ...base.timingScores, ...(loaded.timingScores || {}) }
  for (const id of TIME_SLOT_IDS) {
    if (timingScores[id] === undefined) timingScores[id] = 0
  }

  const toneScores = { ...base.toneScores, ...(loaded.toneScores || {}) }
  for (const t of TONES) {
    if (toneScores[t] === undefined) toneScores[t] = 0
  }

  const contentScores = { ...base.contentScores, ...(loaded.contentScores || {}) }
  for (const id of MICRO_ACTION_IDS) {
    if (contentScores[id] === undefined) contentScores[id] = 0
  }

  const userProfile = migrateUserProfile(loaded.userProfile)

  return {
    ...base,
    ...loaded,
    userProfile,
    dailyContext: { ...base.dailyContext, ...(loaded.dailyContext || {}) },
    matchedCohortId: loaded.matchedCohortId ?? null,
    cohortMatchScore: typeof loaded.cohortMatchScore === 'number' ? loaded.cohortMatchScore : 0,
    timingScores,
    toneScores,
    contentScores,
    durationStats: {
      bySlot: { ...(loaded.durationStats?.bySlot || {}) },
      byContent: { ...(loaded.durationStats?.byContent || {}) },
    },
    feedbackHistory: Array.isArray(loaded.feedbackHistory) ? loaded.feedbackHistory : [],
    lastRecommendation: loaded.lastRecommendation ?? null,
  }
}

/** @returns {AppStateV2} */
export function loadAppState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createInitialAppState()
    return normalizeAppState(JSON.parse(raw))
  } catch {
    return createInitialAppState()
  }
}

/** @param {AppStateV2} state */
export function saveAppState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/** @returns {AppStateV2} */
export function resetDemoData() {
  const fresh = createInitialAppState()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh))
  return fresh
}

/**
 * @param {string[]} ids
 * @param {Record<string, string>} labels
 */
export function formatIdListForDisplay(ids, labels) {
  if (!ids?.length) return '—'
  return ids.map((id) => labels[id] ?? id).join(', ')
}
