import { COHORT_PROFILES } from '../data/cohortProfiles.js'
import { PREFERRED_TIME_RANGE_IDS, MAIN_BARRIER_IDS } from '../utils/storage.js'

/**
 * Checkbox labels for preferred time windows (ids stored as snake_case).
 */
export const TIME_RANGE_OPTIONS = [
  { id: 'morning', label: 'Morning (7:00–11:30)' },
  { id: 'afternoon', label: 'Afternoon (12:00–3:30 PM)' },
  { id: 'evening', label: 'Evening (4:00–7:00 PM)' },
  { id: 'after_dinner', label: 'After dinner (7:30–9:30 PM)' },
]

function profileTimeRanges(profile) {
  const list = profile.preferredTimeRanges
  if (!Array.isArray(list)) return []
  return list.filter((id) => PREFERRED_TIME_RANGE_IDS.includes(id))
}

function profileBarriers(profile) {
  const list = profile.mainBarriers
  if (!Array.isArray(list)) return []
  return list.filter((id) => MAIN_BARRIER_IDS.includes(id))
}

/**
 * How well the cohort's time hints align with the user's selected windows.
 * Averages a per-window hit score so multiple matching windows all help.
 */
function cohortTimeOverlapMulti(cohort, userRanges) {
  const cohortRanges = cohort.matchHints?.timeRanges ?? []
  if (userRanges.length === 0) return 0.5
  let sum = 0
  for (const r of userRanges) {
    sum += cohortRanges.includes(r) ? 1 : 0.2
  }
  return sum / userRanges.length
}

/**
 * Strongest barrier signal: best match between any user-selected barrier and this cohort.
 */
function barrierMatchStrongest(cohort, userBarriers) {
  if (!userBarriers.length) return 0.5
  let best = 0
  for (const barrierId of userBarriers) {
    best = Math.max(best, barrierMatchOne(cohort, barrierId))
  }
  return best
}

function barrierMatchOne(cohort, barrierId) {
  const b = cohort.matchHints?.barriers ?? []
  if (b.includes(barrierId)) return 1
  if (barrierId === 'weather' && cohort.id === 'pain_cautious') return 0.4
  return 0.15
}

function confidenceMatch(cohort, confidence) {
  const c = cohort.matchHints?.confidence ?? []
  if (c.length === 0) return 0.4
  return c.includes(confidence) ? 1 : 0.25
}

function painMatch(cohort, painConcern) {
  const wantsPain = cohort.matchHints?.painConcern === true
  if (wantsPain) return painConcern === 'yes' ? 1 : 0.2
  return painConcern === 'yes' ? 0.35 : 0.6
}

function toneMatch(cohort, preferredTone) {
  if (!preferredTone) return 0.5
  return cohort.preferredTone === preferredTone ? 1 : 0.35
}

/**
 * @param {import('../utils/storage.js').UserProfileV2} profile
 * @returns {{ cohortId: string, cohort: object, matchScore: number }}
 */
export function matchCohort(profile) {
  const ranges = profileTimeRanges(profile)
  const barriers = profileBarriers(profile)
  let best = COHORT_PROFILES[0]
  let bestScore = -1

  for (const cohort of COHORT_PROFILES) {
    let s = 0
    s += 2.0 * barrierMatchStrongest(cohort, barriers)
    s += 1.5 * cohortTimeOverlapMulti(cohort, ranges)
    s += 1.2 * confidenceMatch(cohort, profile.baselineConfidence)
    s += 1.0 * painMatch(cohort, profile.painConcern)
    s += 1.3 * toneMatch(cohort, profile.preferredTone)
    if (s > bestScore) {
      bestScore = s
      best = cohort
    }
  }

  return {
    cohortId: best.id,
    cohort: best,
    matchScore: Math.round(bestScore * 10) / 10,
  }
}
