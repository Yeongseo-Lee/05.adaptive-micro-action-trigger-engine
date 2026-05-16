import { TIME_SLOT_IDS } from '../data/timeSlots.js'
import { TONES } from '../data/promptTemplates.js'
import { MICRO_ACTION_IDS } from '../data/microActions.js'
import { getCohortById } from '../data/cohortProfiles.js'
import { computeBurden } from './burdenScorer.js'
import { midpointForBucket, normalizeDurationBucket, normalizeResponse } from './feedbackUpdater.js'

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
    if (row.yes < 1 && row.totalPrompts < 3) continue
    const rate = row.yesRate
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

function personalizationLabel(feedbackCount) {
  if (feedbackCount < 5) return 'Low'
  if (feedbackCount < 15) return 'Med'
  return 'High'
}

export function buildTimeSlotAnalytics(feedbackHistory) {
  const bySlot = Object.fromEntries(
    TIME_SLOT_IDS.map((slotId) => [
      slotId,
      {
        timeSlot: slotId,
        totalPrompts: 0,
        yes: 0,
        no: 0,
        skip: 0,
        yesRate: 0,
        averageActualDurationMinutes: null,
        burdenSignal: 0,
      },
    ]),
  )

  for (const row of feedbackHistory ?? []) {
    const slot = row.timeSlot ?? row.recommendation?.timeSlotId
    if (!bySlot[slot]) continue
    const response = normalizeResponse(row.response)
    if (response !== 'yes' && response !== 'no' && response !== 'skip') continue

    const cell = bySlot[slot]
    cell.totalPrompts += 1
    cell[response] += 1

    if (response === 'yes') {
      const actualDuration = normalizeDurationBucket(row.actualDuration ?? row.durationBucket)
      const minutes = midpointForBucket(actualDuration)
      if (minutes) {
        cell.durationSum = (cell.durationSum ?? 0) + minutes
        cell.durationCount = (cell.durationCount ?? 0) + 1
      }
    }
  }

  for (const cell of Object.values(bySlot)) {
    cell.yesRate = cell.totalPrompts
      ? Math.round((cell.yes / cell.totalPrompts) * 1000) / 1000
      : 0
    cell.averageActualDurationMinutes = cell.durationCount
      ? Math.round((cell.durationSum / cell.durationCount) * 10) / 10
      : null
    cell.burdenSignal = cell.no + cell.skip
    delete cell.durationSum
    delete cell.durationCount
  }

  return bySlot
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
  const timeSlotAnalytics = buildTimeSlotAnalytics(hist)

  for (const row of hist) {
    const response = normalizeResponse(row.response)
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
  for (const [slotId, row] of Object.entries(timeSlotAnalytics)) {
    yesRateByTimeSlot[slotId] = row.yesRate
  }
  const fallbackStartSlot = cohort?.preferredSlotIds?.[0] ?? bestSlot.key
  const bestSlotByYes = bestRate(timeSlotAnalytics, fallbackStartSlot)
  const bestSlotByDuration = bestAverage(bySlotAverages, '—')

  return {
    yesRate,
    noRate,
    skipRate,
    averageMovementDuration: avgDuration,
    averageDurationBySlot: bySlotAverages,
    averageDurationByContent: byContentAverages,
    globalAverageFromStats: averageFromCells(state.durationStats?.bySlot),
    timeSlotAnalytics,
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
    personalizationLevelLabel: personalizationLabel(hist.length),
    matchedCohortId: state.matchedCohortId,
    matchedCohortLabel: cohort?.label ?? '—',
    cohortMatchScore: state.cohortMatchScore ?? 0,
    notificationBurdenLevel: burden.level,
    notificationBurdenRate: burden.recentNoSkipRate,
    feedbackCount: hist.length,
  }
}
