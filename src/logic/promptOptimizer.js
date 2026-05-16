import { TIME_SLOTS, getSlotById, slotMatchesNamedRange } from '../data/timeSlots.js'
import { TONES, composePromptMessage, renderPromptTemplate } from '../data/promptTemplates.js'
import { MICRO_ACTIONS, getMicroActionById } from '../data/microActions.js'
import { evaluateSafety } from './safetyFilter.js'
import { computeBurden } from './burdenScorer.js'
import { buildTimeSlotAnalytics } from './analytics.js'
import { normalizeResponse } from './feedbackUpdater.js'

function durationLabel(minutes) {
  if (minutes === 1.5) return '1–2 minutes'
  if (minutes === 4) return '3–5 minutes'
  if (minutes === 7.5) return '5–10 minutes'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h} hour${h === 1 ? '' : 's'}`
}

function cohortPriorScore(cohort, slotId, tone, actionId, durationMinutes) {
  if (!cohort) return 0
  let s = 0
  if (cohort.preferredSlotIds?.includes(slotId)) s += 1.2
  if (cohort.preferredTone === tone) s += 0.9
  if (cohort.preferredContentIds?.includes(actionId)) s += 1.0
  s += cohort.toneBoosts?.[tone] ?? 0
  s += cohort.contentBoosts?.[actionId] ?? 0
  const pref = cohort.preferredDurationMinutes ?? 2
  const diff = Math.abs(durationMinutes - pref)
  s += Math.max(0, 0.6 - diff * 0.15)
  return s
}

function dailyContextFit(dailyContext, action, tone, slot) {
  let s = 0
  const fatigue = dailyContext.fatigueToday ?? 3
  const pain = dailyContext.painToday ?? 0
  const motivation = dailyContext.motivationToday ?? 3
  const weather = dailyContext.weather
  const availability = dailyContext.availabilityToday

  if (action.suitableForFatigue && fatigue >= 4) s += 0.7
  if (action.suitableForPain && pain >= 2) s += 0.6
  if (weather === 'bad' && action.goodForWeatherBad) s += 0.5
  if (motivation <= 2 && (tone === 'gentle' || tone === 'motivational')) s += 0.35
  if (availability === 'low' && slot && slot.hour >= 17) s += 0.25
  if (availability === 'high') s += 0.15

  if (tone === 'risk_framed' && motivation <= 2) s -= 0.4
  if (tone === 'motivational' && fatigue >= 5) s -= 0.25

  return s
}

/**
 * Additive bonus for each selected preferred window that contains this slot (capped).
 */
function userPreferredSlotBonuses(profile, slotId) {
  const ranges = profile.preferredTimeRanges
  if (!Array.isArray(ranges) || ranges.length === 0) return 0
  const slot = getSlotById(slotId)
  if (!slot) return 0
  let bonus = 0
  for (const rangeId of ranges) {
    if (slotMatchesNamedRange(slot, rangeId)) bonus += 0.35
  }
  return Math.min(bonus, 1.1)
}

function responseStats(feedbackHistory) {
  const byTone = {}
  const byContent = {}
  for (const row of feedbackHistory ?? []) {
    const response = normalizeResponse(row.response)
    const tone = row.tone ?? row.recommendation?.tone
    const content = row.content ?? row.action ?? row.recommendation?.microActionId
    for (const [map, key] of [
      [byTone, tone],
      [byContent, content],
    ]) {
      if (!key) continue
      map[key] = map[key] ?? { yes: 0, total: 0 }
      if (response === 'yes') map[key].yes += 1
      if (response === 'yes' || response === 'no' || response === 'skip') map[key].total += 1
    }
  }
  return { byTone, byContent }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function learnedScore(value) {
  return clamp01(0.5 + (value ?? 0) / 8)
}

function yesRateScore(stats, key) {
  const row = stats[key]
  if (!row?.total) return 0.5
  return clamp01(row.yes / row.total)
}

function averageDurationCell(cell) {
  if (!cell?.count) return 0
  return cell.sum / cell.count
}

function personalizationWeights(feedbackCount) {
  if (feedbackCount < 5) {
    return { groupWeight: 0.8, individualWeight: 0.2, level: 'Low' }
  }
  if (feedbackCount < 15) {
    return { groupWeight: 0.5, individualWeight: 0.5, level: 'Medium' }
  }
  return { groupWeight: 0.2, individualWeight: 0.8, level: 'High' }
}

function profileSlotDefault(userProfile, matchedCohort, slotId) {
  const profileBonus = userPreferredSlotBonuses(userProfile, slotId) > 0 ? 0.18 : 0
  const cohortBonus = matchedCohort?.preferredSlotIds?.includes(slotId) ? 0.22 : 0
  return clamp01(0.42 + profileBonus + cohortBonus)
}

function slotYesLikelihood(slotStats, userProfile, matchedCohort, slotId, weights) {
  const row = slotStats[slotId]
  const groupScore = profileSlotDefault(userProfile, matchedCohort, slotId)
  const individualScore = row?.totalPrompts ? row.yesRate : 0.5
  return clamp01(groupScore * weights.groupWeight + individualScore * weights.individualWeight)
}

function expectedDurationProfileDefault(matchedCohort, action) {
  return matchedCohort?.preferredDurationMinutes || action.defaultDuration || 2
}

function expectedDurationScore(slotStats, durationStats, matchedCohort, slotId, actionId, action, weights) {
  const slotAvg = slotStats[slotId]?.averageActualDurationMinutes ?? averageDurationCell(durationStats?.bySlot?.[slotId])
  const contentAvg = averageDurationCell(durationStats?.byContent?.[actionId])
  const individualDuration = slotAvg && contentAvg ? (slotAvg + contentAvg) / 2 : slotAvg || contentAvg || 0
  const groupDuration = expectedDurationProfileDefault(matchedCohort, action)
  const expectedDuration = individualDuration
    ? groupDuration * weights.groupWeight + individualDuration * weights.individualWeight
    : groupDuration
  return {
    expectedDuration,
    score: clamp01(expectedDuration / 10),
  }
}

function toneFitScore(toneScores, behavior, userProfile, matchedCohort, tone, weights) {
  const cohortToneScore = clamp01(
    0.45 +
      (userProfile.preferredTone === tone ? 0.18 : 0) +
      (matchedCohort?.preferredTone === tone ? 0.18 : 0) +
      (matchedCohort?.toneBoosts?.[tone] ?? 0) * 0.18,
  )
  const individualToneScore = (learnedScore(toneScores[tone]) + yesRateScore(behavior.byTone, tone)) / 2
  return clamp01(cohortToneScore * weights.groupWeight + individualToneScore * weights.individualWeight)
}

function actionFitScore(contentScores, behavior, matchedCohort, actionId, weights) {
  const cohortActionScore = clamp01(
    0.45 +
      (matchedCohort?.preferredContentIds?.includes(actionId) ? 0.2 : 0) +
      (matchedCohort?.contentBoosts?.[actionId] ?? 0) * 0.18,
  )
  const individualActionScore =
    (learnedScore(contentScores[actionId]) + yesRateScore(behavior.byContent, actionId)) / 2
  return clamp01(cohortActionScore * weights.groupWeight + individualActionScore * weights.individualWeight)
}

function suggestDurationMinutes(expectedDuration, yesLikelihoodScore, dailyContext, burden, action) {
  const pain = dailyContext.painToday ?? 0
  const fatigue = dailyContext.fatigueToday ?? 1
  const highLoad = pain >= 4 || fatigue >= 4 || burden.level === 'high'
  const mediumLoad = pain >= 2 || fatigue >= 3 || burden.level === 'medium'

  let minutes
  if (expectedDuration < 2.5) minutes = 1.5
  else if (expectedDuration < 5) minutes = 4
  else if (yesLikelihoodScore >= 0.55) minutes = 7.5
  else minutes = 4

  if (highLoad) minutes = Math.min(minutes, action.intensity === 'very_low' ? 2 : 1.5)
  else if (mediumLoad) minutes = Math.min(minutes, 4)

  return minutes
}

/**
 * @param {object} params
 * @returns {object | null}
 */
export function optimizePrompt({
  userProfile,
  dailyContext,
  matchedCohort,
  toneScores,
  contentScores,
  durationStats,
  feedbackHistory,
}) {
  const burden = computeBurden(feedbackHistory)
  const behavior = responseStats(feedbackHistory)
  const slotStats = buildTimeSlotAnalytics(feedbackHistory)
  const feedbackCount = feedbackHistory?.length ?? 0
  const weights = personalizationWeights(feedbackCount)
  const dataLimited = weights.level === 'Low'
  let best = null
  let bestTotal = -Infinity

  for (const slot of TIME_SLOTS) {
    for (const tone of TONES) {
      for (const action of MICRO_ACTIONS) {
        const safety = evaluateSafety(dailyContext, userProfile, action.id)
        if (safety.blockAction) continue

        const cohortDefaultDuration = expectedDurationProfileDefault(matchedCohort, action)
        const yesLikelihoodScore = slotYesLikelihood(
          slotStats,
          userProfile,
          matchedCohort,
          slot.id,
          weights,
        )
        const duration = expectedDurationScore(
          slotStats,
          durationStats,
          matchedCohort,
          slot.id,
          action.id,
          action,
          weights,
        )
        const durationMinutes = suggestDurationMinutes(
          duration.expectedDuration,
          yesLikelihoodScore,
          dailyContext,
          burden,
          action,
        )
        const cohortP = cohortPriorScore(matchedCohort, slot.id, tone, action.id, durationMinutes)
        const ctxFit = dailyContextFit(dailyContext, action, tone, slot)
        const toneScore = toneFitScore(toneScores, behavior, userProfile, matchedCohort, tone, weights)
        const contentScore = actionFitScore(contentScores, behavior, matchedCohort, action.id, weights)
        const cohortPriorScoreValue = clamp01(cohortP / 5.7)
        const contextFitScore = clamp01(0.5 + ctxFit / 2)
        const safetyPen = safety.safetyPenalty + (safety.safetyMode ? 0.15 : 0)
        let burdenPenalty = burden.penalty + (slotStats[slot.id]?.burdenSignal ?? 0) * 0.12
        if (matchedCohort?.burdenSensitivity === 'high') burdenPenalty += burden.penalty * 0.15
        if ((dailyContext.fatigueToday ?? 1) >= 4 && (tone === 'risk_framed' || tone === 'motivational')) {
          burdenPenalty += 0.35
        }
        if ((dailyContext.painToday ?? 0) >= 4 && tone !== 'gentle' && tone !== 'informational') {
          burdenPenalty += 0.35
        }
        if (burden.level === 'high' && (tone === 'risk_framed' || tone === 'motivational')) {
          burdenPenalty += 0.45
        }

        const total =
          yesLikelihoodScore * 0.3 +
          duration.score * 0.2 +
          toneScore * 0.15 +
          contentScore * 0.15 +
          cohortPriorScoreValue * 0.15 +
          contextFitScore * 0.05 -
          safetyPen -
          burdenPenalty

        if (total > bestTotal) {
          bestTotal = total
          const body = composePromptMessage(tone, action.id, durationMinutes)
          const detailPrompt = renderPromptTemplate(tone, {
            time: slot.label,
            action: action.label.toLowerCase(),
            duration: durationLabel(durationMinutes),
          })
          best = {
            channel: 'push_notification',
            timeSlotId: slot.id,
            timeSlotLabel: slot.label,
            tone,
            microActionId: action.id,
            microActionLabel: action.label,
            suggestedDurationMinutes: durationMinutes,
            renderedPrompt: body,
            detailPrompt,
            safetyMode: safety.safetyMode,
            safetyReasons: safety.reasons,
            scoreBreakdown: {
              yesLikelihoodScore,
              expectedDurationScore: duration.score,
              toneScore,
              contentScore,
              cohortPriorScore: cohortPriorScoreValue,
              contextFitScore,
              safetyPenalty: safetyPen,
              burdenPenalty,
              expectedDuration: duration.expectedDuration
                ? Math.round(duration.expectedDuration * 10) / 10
                : null,
              cohortDefaultDuration,
              groupWeight: weights.groupWeight,
              individualWeight: weights.individualWeight,
              personalizationLevel: weights.level,
              dataLimited,
              total,
            },
          }
        }
      }
    }
  }

  if (!best) {
    const slot = TIME_SLOTS[0]
    const action = getMicroActionById('ankle_movement') ?? MICRO_ACTIONS[0]
    const tone = 'gentle'
    const durationMinutes = 1
    const safety = evaluateSafety(dailyContext, userProfile, action.id)
    const body = composePromptMessage(tone, action.id, durationMinutes)
    const detailPrompt = renderPromptTemplate(tone, {
      time: slot.label,
      action: action.label.toLowerCase(),
      duration: durationLabel(durationMinutes),
    })
    best = {
      channel: 'push_notification',
      timeSlotId: slot.id,
      timeSlotLabel: slot.label,
      tone,
      microActionId: action.id,
      microActionLabel: action.label,
      suggestedDurationMinutes: durationMinutes,
      renderedPrompt: body,
      detailPrompt,
      safetyMode: safety.safetyMode,
      safetyReasons: ['Fallback: safest default prompt while filters were tight.'],
      scoreBreakdown: {
        yesLikelihoodScore: 0,
        expectedDurationScore: 0,
        toneScore: 0,
        contentScore: 0,
        cohortPriorScore: 0,
        contextFitScore: 0,
        safetyPenalty: 0,
        burdenPenalty: 0,
        expectedDuration: null,
        cohortDefaultDuration: 1,
        groupWeight: 0.8,
        individualWeight: 0.2,
        personalizationLevel: 'Low',
        dataLimited: true,
        total: 0,
      },
    }
  }

  return best
}
