const WINDOW = 15

/**
 * Burden from recent push responses (No / Skip).
 * @param {Array<{ response: string }>} feedbackHistory newest first
 */
export function computeBurden(feedbackHistory) {
  const recent = feedbackHistory.slice(0, WINDOW)
  if (recent.length === 0) {
    return { level: 'low', penalty: 0, recentNoSkipRate: 0, sampleSize: 0 }
  }

  let noSkip = 0
  for (const row of recent) {
    if (row.response === 'No' || row.response === 'Skip') noSkip++
  }
  const rate = noSkip / recent.length

  let level = 'low'
  let penalty = 0
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
