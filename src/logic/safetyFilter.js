import { getMicroActionById } from '../data/microActions.js'

/**
 * @param {import('../utils/storage.js').DailyContextV2} dailyContext
 * @param {import('../utils/storage.js').UserProfileV2} userProfile
 * @param {string} microActionId
 */
export function evaluateSafety(dailyContext, userProfile, microActionId) {
  const action = getMicroActionById(microActionId)
  const painToday = dailyContext.painToday ?? 0
  const fatigueToday = dailyContext.fatigueToday ?? 1
  const painConcern = userProfile.painConcern === 'yes'

  const painHigh = painToday >= 4
  const fatigueHigh = fatigueToday >= 4

  let safetyMode = painHigh || (painConcern && painToday >= 2)
  if (fatigueHigh && fatigueToday >= 5) safetyMode = true

  let actionPenalty = 0
  let reasons = []

  if (!action) {
    return { safetyMode: true, safetyPenalty: 5, reasons: ['Unknown action'], blockAction: true }
  }

  if (painHigh && !action.suitableForPain) {
    actionPenalty += 2.5
    reasons.push('Higher pain today: favor actions marked suitable for pain.')
  }

  if (fatigueHigh && !action.suitableForFatigue) {
    actionPenalty += 1.5
    reasons.push('Higher fatigue today: favor lower-demand movements.')
  }

  if (painConcern && painToday >= 1 && action.intensity !== 'very_low' && action.intensity !== 'low') {
    actionPenalty += 0.5
  }

  if (dailyContext.weather === 'bad' && !action.goodForWeatherBad) {
    actionPenalty += 0.8
    reasons.push('Weather noted as bad: indoor-friendly actions score better.')
  }

  const safetyPenalty = actionPenalty + (safetyMode ? 0.3 : 0)

  return {
    safetyMode,
    safetyPenalty,
    reasons,
    blockAction: actionPenalty >= 3,
  }
}
