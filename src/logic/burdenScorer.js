const WINDOW = 15

function normalizeResponse(response) {
  const value = String(response ?? '').toLowerCase()
  if (value === 'done') return 'yes'
  return value
}

/**
 * Burden from recent push responses (No / Skip).
 * @param {Array<{ response: string }>} feedbackHistory newest first
 */
export function computeBurden(feedbackHistory) {
  const recent = feedbackHistory.slice(0, WINDOW)
  if (recent.length === 0) {
    return { level: 'low', penalty: 0, recentNoSkipRate: 0, sampleSize: 0 }
  }

  let burdenPoints = 0
  for (const row of recent) {
    const response = normalizeResponse(row.response)
    if (response === 'no') burdenPoints += 1
    if (response === 'skip') burdenPoints += 1.4
  }
  const rate = burdenPoints / recent.length

  let level
  let penalty
  if (rate >= 0.55) {
    level = 'high'
    penalty = 1.8
  } else if (rate >= 0.3) {
    level = 'medium'
    penalty = 0.9
  } else {
    level = 'low'
    penalty = 0
  }

  return {
    level,
    penalty,
    recentNoSkipRate: Math.round(rate * 100) / 100,
    sampleSize: recent.length,
  }
}
