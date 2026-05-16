/** @typedef {'<1'|'1–2'|'3–5'|'5–10'|'10+'} DurationBucketId */

export const DURATION_OPTIONS = [
  { id: '<1', label: '<1 min', midpointMinutes: 0.5 },
  { id: '1–2', label: '1–2 min', midpointMinutes: 1.5 },
  { id: '3–5', label: '3–5 min', midpointMinutes: 4 },
  { id: '5–10', label: '5–10 min', midpointMinutes: 7.5 },
  { id: '10+', label: '10+ min', midpointMinutes: 10 },
]

export function midpointForBucket(bucketId) {
  const normalized = normalizeDurationBucket(bucketId)
  const row = DURATION_OPTIONS.find((o) => o.id === normalized)
  return row?.midpointMinutes ?? 0
}

export function normalizeDurationBucket(bucketId) {
  if (bucketId === '1-2') return '1–2'
  if (bucketId === '3-5') return '3–5'
  if (bucketId === '5-10') return '5–10'
  return bucketId ?? null
}

export function normalizeResponse(response) {
  const value = String(response ?? '').toLowerCase()
  if (value === 'done' || value === 'yes') return 'yes'
  if (value === 'no') return 'no'
  if (value === 'skip') return 'skip'
  return value
}

function durationBonus(bucketId) {
  const bucket = normalizeDurationBucket(bucketId)
  if (bucket === '3–5') return 0.5
  if (bucket === '5–10') return 1
  if (bucket === '10+') return 1.5
  return 0
}

function bumpCell(target, key, deltaMinutes) {
  if (!key) return
  const cell = target[key] ?? { sum: 0, count: 0 }
  cell.sum += deltaMinutes
  cell.count += 1
  target[key] = cell
}

/**
 * @param {object} durationStats
 * @param {string} slotId
 * @param {string} contentId
 * @param {string} bucketId
 */
export function recordDurationObservation(durationStats, slotId, contentId, bucketId) {
  const actualDuration = normalizeDurationBucket(bucketId)
  const minutes = midpointForBucket(actualDuration)
  if (!minutes) return durationStats
  const bySlot = { ...(durationStats.bySlot || {}) }
  const byContent = { ...(durationStats.byContent || {}) }
  bumpCell(bySlot, slotId, minutes)
  bumpCell(byContent, contentId, minutes)
  return { bySlot, byContent }
}

/**
 * Apply yes / no / skip adjustments to learner scores.
 * @param {object} scores — { timingScores, toneScores, contentScores, durationStats }
 * @param {object} recommendation — output shape from promptOptimizer
 * @param {'yes'|'no'|'skip'|'Yes'|'No'|'Skip'} response
 * @param {string | null} durationBucket — when response is yes and user answered follow-up
 */
export function applyFeedbackToScores(scores, recommendation, response, durationBucket) {
  const timingScores = { ...scores.timingScores }
  const toneScores = { ...scores.toneScores }
  const contentScores = { ...scores.contentScores }
  let durationStats = scores.durationStats
    ? {
        bySlot: { ...(scores.durationStats.bySlot || {}) },
        byContent: { ...(scores.durationStats.byContent || {}) },
      }
    : { bySlot: {}, byContent: {} }

  const slot = recommendation.timeSlotId
  const tone = recommendation.tone
  const content = recommendation.microActionId
  const normalizedResponse = normalizeResponse(response)

  if (normalizedResponse === 'yes') {
    const extra = durationBonus(durationBucket)
    timingScores[slot] = (timingScores[slot] ?? 0) + 1
    toneScores[tone] = (toneScores[tone] ?? 0) + 1 + extra
    contentScores[content] = (contentScores[content] ?? 0) + 1 + extra
    if (durationBucket) {
      durationStats = recordDurationObservation(
        durationStats,
        slot,
        content,
        durationBucket,
      )
    }
  } else if (normalizedResponse === 'no') {
    timingScores[slot] = (timingScores[slot] ?? 0) - 0.2
    toneScores[tone] = (toneScores[tone] ?? 0) - 1
    contentScores[content] = (contentScores[content] ?? 0) - 1
  } else if (normalizedResponse === 'skip') {
    timingScores[slot] = (timingScores[slot] ?? 0) - 0.9
    toneScores[tone] = (toneScores[tone] ?? 0) - 0.2
    contentScores[content] = (contentScores[content] ?? 0) - 0.2
  }

  return { timingScores, toneScores, contentScores, durationStats }
}
