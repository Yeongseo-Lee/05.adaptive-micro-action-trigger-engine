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
  let no = 0
  let skip = 0
  for (const row of recent) {
    const response = normalizeResponse(row.response)
    if (response === 'no') {
      burdenPoints += 1
      no++
    }
    if (response === 'skip') {
      burdenPoints += 1.4
      skip++
    }
  }
  const rate = burdenPoints / recent.length
  const noRate = no / recent.length
  const skipRate = skip / recent.length

  let level
  let penalty
  if (skipRate >= 0.45 || rate >= 0.55) {
    level = 'high'
    penalty = 1.8
  } else if (skipRate >= 0.25 || noRate >= 0.35 || rate >= 0.3) {
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
    recentNoRate: Math.round(noRate * 100) / 100,
    recentSkipRate: Math.round(skipRate * 100) / 100,
    sampleSize: recent.length,
  }
}
