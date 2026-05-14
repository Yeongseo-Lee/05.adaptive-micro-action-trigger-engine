import { TIME_SLOT_IDS } from '../data/timeSlots.js'
import { TONES } from '../data/promptTemplates.js'
import { MICRO_ACTION_IDS } from '../data/microActions.js'
import { getCohortById } from '../data/cohortProfiles.js'
import { computeBurden } from './burdenScorer.js'
import { midpointForBucket } from './feedbackUpdater.js'

function bestKey(scores, keys) {
  let best = keys[0]
  let bestV = scores[best] ?? 0
  for (const k of keys) {
    const v = scores[k] ?? 0
    if (v > bestV) {
      bestV = v
      best = k
    }
  }
  return { key: best, value: bestV }
}

function averageFromCells(cells) {
  const vals = Object.values(cells || {})
  if (!vals.length) return null
  let sum = 0
  let n = 0
  for (const c of vals) {
    if (c.count > 0) {
      sum += c.sum / c.count
      n += 1
    }
  }
  if (n === 0) return null
  return Math.round((sum / n) * 10) / 10
}

function personalizationFromState(state) {
  const n = state.feedbackHistory?.length ?? 0
  const spread =
    Math.abs(state.toneScores?.gentle ?? 0) +
    Math.abs(state.toneScores?.motivational ?? 0) +
    Math.abs(state.contentScores?.indoor_walk ?? 0)
  const level = Math.min(100, Math.round(n * 3.5 + Math.min(35, spread * 2)))
  if (n === 0) return 0
  return Math.max(8, level)
}

/**
 * @param {import('../utils/storage.js').AppStateV2} state
 */
export function computeAnalytics(state) {
  const hist = state.feedbackHistory ?? []
  let yes = 0
  let no = 0
  let skip = 0
  const durationSamples = []

  for (const row of hist) {
    if (row.response === 'Yes') {
      yes++
      if (row.durationBucket) {
        durationSamples.push(midpointForBucket(row.durationBucket))
      }
    } else if (row.response === 'No') no++
    else if (row.response === 'Skip') skip++
  }

  const total = yes + no + skip || 1
  const yesRate = Math.round((yes / total) * 1000) / 1000
  const noRate = Math.round((no / total) * 1000) / 1000
  const skipRate = Math.round((skip / total) * 1000) / 1000

  const avgDuration =
    durationSamples.length > 0
      ? Math.round(
          (durationSamples.reduce((a, b) => a + b, 0) / durationSamples.length) * 10,
        ) / 10
      : null

  const bestSlot = bestKey(state.timingScores ?? {}, TIME_SLOT_IDS)
  const bestTone = bestKey(state.toneScores ?? {}, TONES)
  const bestContent = bestKey(state.contentScores ?? {}, MICRO_ACTION_IDS)

  const cohort = state.matchedCohortId ? getCohortById(state.matchedCohortId) : null
  const burden = computeBurden(hist)

  const bySlotAverages = {}
  const ds = state.durationStats?.bySlot ?? {}
  for (const [slotId, cell] of Object.entries(ds)) {
    if (cell.count > 0) bySlotAverages[slotId] = Math.round((cell.sum / cell.count) * 10) / 10
  }

  return {
    yesRate,
    noRate,
    skipRate,
    averageMovementDuration: avgDuration,
    averageDurationBySlot: bySlotAverages,
    globalAverageFromStats: averageFromCells(state.durationStats?.bySlot),
    bestTimeSlot: bestSlot.key,
    bestTimeSlotScore: Math.round(bestSlot.value * 100) / 100,
    bestTone: bestTone.key,
    bestToneScore: Math.round(bestTone.value * 100) / 100,
    bestContent: bestContent.key,
    bestContentScore: Math.round(bestContent.value * 100) / 100,
    personalizationLevel: personalizationFromState(state),
    matchedCohortId: state.matchedCohortId,
    matchedCohortLabel: cohort?.label ?? '—',
    cohortMatchScore: state.cohortMatchScore ?? 0,
    notificationBurdenLevel: burden.level,
    notificationBurdenRate: burden.recentNoSkipRate,
    feedbackCount: hist.length,
  }
}
