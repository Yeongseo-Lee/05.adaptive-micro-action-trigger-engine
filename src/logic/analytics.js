import { TIME_SLOT_IDS } from '../data/timeSlots.js'
import { TONES } from '../data/promptTemplates.js'
import { MICRO_ACTION_IDS } from '../data/microActions.js'
import { getCohortById } from '../data/cohortProfiles.js'
import { computeBurden } from './burdenScorer.js'
import { midpointForBucket, normalizeResponse } from './feedbackUpdater.js'

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

function bestRate(stats, fallbackKey) {
  let best = fallbackKey
  let bestV = -1
  for (const [key, row] of Object.entries(stats)) {
    const shown = row.yes + row.no + row.skip
    if (shown === 0) continue
    const rate = row.yes / shown
    if (rate > bestV) {
      bestV = rate
      best = key
    }
  }
  return { key: best, value: Math.max(0, bestV) }
}

function bestAverage(averages, fallbackKey) {
  let best = fallbackKey
  let bestV = -1
  for (const [key, value] of Object.entries(averages)) {
    if (value > bestV) {
      bestV = value
      best = key
    }
  }
  return { key: best, value: Math.max(0, bestV) }
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
  const responseBySlot = {}

  for (const row of hist) {
    const response = normalizeResponse(row.response)
    const slot = row.timeSlot ?? row.recommendation?.timeSlotId
    if (slot) {
      responseBySlot[slot] = responseBySlot[slot] ?? { yes: 0, no: 0, skip: 0 }
      if (responseBySlot[slot][response] !== undefined) responseBySlot[slot][response] += 1
    }

    if (response === 'yes') {
      yes++
      const actualDuration = row.actualDuration ?? row.durationBucket
      if (actualDuration) {
        durationSamples.push(midpointForBucket(actualDuration))
      }
    } else if (response === 'no') no++
    else if (response === 'skip') skip++
  }

  const total = yes + no + skip
  const yesRate = total ? Math.round((yes / total) * 1000) / 1000 : 0
  const noRate = total ? Math.round((no / total) * 1000) / 1000 : 0
  const skipRate = total ? Math.round((skip / total) * 1000) / 1000 : 0

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
  const byContentAverages = {}
  const dc = state.durationStats?.byContent ?? {}
  for (const [contentId, cell] of Object.entries(dc)) {
    if (cell.count > 0) byContentAverages[contentId] = Math.round((cell.sum / cell.count) * 10) / 10
  }

  const yesRateByTimeSlot = {}
  for (const [slotId, row] of Object.entries(responseBySlot)) {
    const shown = row.yes + row.no + row.skip
    yesRateByTimeSlot[slotId] = shown ? Math.round((row.yes / shown) * 1000) / 1000 : 0
  }
  const bestSlotByYes = bestRate(responseBySlot, bestSlot.key)
  const bestSlotByDuration = bestAverage(bySlotAverages, bestSlot.key)

  return {
    yesRate,
    noRate,
    skipRate,
    averageMovementDuration: avgDuration,
    averageDurationBySlot: bySlotAverages,
    averageDurationByContent: byContentAverages,
    globalAverageFromStats: averageFromCells(state.durationStats?.bySlot),
    yesRateByTimeSlot,
    bestTimeSlotByYesRate: bestSlotByYes.key,
    bestTimeSlotByYesRateValue: Math.round(bestSlotByYes.value * 1000) / 1000,
    bestTimeSlotByAverageDuration: bestSlotByDuration.key,
    bestTimeSlotByAverageDurationValue: Math.round(bestSlotByDuration.value * 10) / 10,
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
