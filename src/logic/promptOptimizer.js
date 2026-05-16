import { TIME_SLOTS, getSlotById, slotMatchesNamedRange } from '../data/timeSlots.js'
import { TONES, renderPromptTemplate } from '../data/promptTemplates.js'
import { MICRO_ACTIONS, getMicroActionById } from '../data/microActions.js'
import { evaluateSafety } from './safetyFilter.js'
import { computeBurden } from './burdenScorer.js'
import { buildTimeSlotAnalytics } from './analytics.js'
import { normalizeResponse } from './feedbackUpdater.js'

function durationLabel(minutes) {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h} hour${h === 1 ? '' : 's'}`
}

function candidateDurations(action, dailyContext) {
  const base = [1, 2, 3, 5]
  const pain = dailyContext.painToday ?? 0
  const fatigue = dailyContext.fatigueToday ?? 1
  if (pain >= 4) return [1, 2]
  if (pain >= 2 || fatigue >= 4) return [1, 2, 3]
  return base.filter((d) => d >= Math.min(action.defaultDuration, 1))
}

function cohortPriorScore(cohort, slotId, tone, actionId, durationMinutes) {
  if (!cohort) return 0
  let s = 0
  if (cohort.preferredSlotIds?.includes(slotId)) s += 1.2
  if (cohort.preferredTone === tone) s += 0.9
  if (cohort.preferredContentIds?.includes(actionId)) s += 1.0
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
  return clamp01(0.5 + (value ?? 0) / 4)
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

function profileSlotDefault(userProfile, matchedCohort, slotId) {
  const profileBonus = userPreferredSlotBonuses(userProfile, slotId) > 0 ? 0.12 : 0
  const cohortBonus = matchedCohort?.preferredSlotIds?.includes(slotId) ? 0.14 : 0
  return clamp01(0.44 + profileBonus + cohortBonus)
}

function slotYesLikelihood(slotStats, userProfile, matchedCohort, slotId, dataLimited) {
  const row = slotStats[slotId]
  if (row?.totalPrompts > 0) return row.yesRate
  if (dataLimited) return profileSlotDefault(userProfile, matchedCohort, slotId)
  return 0.45
}

function expectedDurationScore(slotStats, durationStats, matchedCohort, slotId, actionId, action) {
  const slotAvg = slotStats[slotId]?.averageActualDurationMinutes ?? averageDurationCell(durationStats?.bySlot?.[slotId])
  const contentAvg = averageDurationCell(durationStats?.byContent?.[actionId])
  const expectedDuration = slotAvg && contentAvg
    ? (slotAvg + contentAvg) / 2
    : slotAvg || contentAvg || matchedCohort?.preferredDurationMinutes || action.defaultDuration
  return {
    expectedDuration,
    score: clamp01(expectedDuration / 10),
  }
}

/**
 * @param {object} params
 * @returns {object | null}
 */
export function optimizePrompt({
  userProfile,
  dailyContext,
  matchedCohort,
  timingScores,
  toneScores,
  contentScores,
  durationStats,
  feedbackHistory,
}) {
  const burden = computeBurden(feedbackHistory)
  const behavior = responseStats(feedbackHistory)
  const slotStats = buildTimeSlotAnalytics(feedbackHistory)
  const dataLimited = (feedbackHistory?.length ?? 0) < 5
  let best = null
  let bestTotal = -Infinity

  for (const slot of TIME_SLOTS) {
    for (const tone of TONES) {
      for (const action of MICRO_ACTIONS) {
        const durs = candidateDurations(action, dailyContext)
        for (const durationMinutes of durs) {
          const safety = evaluateSafety(dailyContext, userProfile, action.id)
          if (safety.blockAction) continue

          const tScore = timingScores[slot.id] ?? 0
          const tnScore = toneScores[tone] ?? 0
          const cScore = contentScores[action.id] ?? 0
          const cohortP = cohortPriorScore(matchedCohort, slot.id, tone, action.id, durationMinutes)
          const ctxFit = dailyContextFit(dailyContext, action, tone, slot)
          const yesLikelihoodScore = slotYesLikelihood(
            slotStats,
            userProfile,
            matchedCohort,
            slot.id,
            dataLimited,
          )
          const duration = expectedDurationScore(
            slotStats,
            durationStats,
            matchedCohort,
            slot.id,
            action.id,
            action,
          )
          const toneScore = clamp01(
            (learnedScore(tnScore) + yesRateScore(behavior.byTone, tone)) / 2 +
              (userProfile.preferredTone === tone || matchedCohort?.preferredTone === tone ? 0.08 : 0),
          )
          const contentScore = clamp01(
            (learnedScore(cScore) + yesRateScore(behavior.byContent, action.id)) / 2 +
              (matchedCohort?.preferredContentIds?.includes(action.id) ? 0.08 : 0),
          )
          const cohortPriorScoreValue = clamp01(cohortP / 3.7)
          const contextFitScore = clamp01(0.5 + ctxFit / 2)
          const safetyPen = safety.safetyPenalty + (safety.safetyMode ? 0.15 : 0)
          let burdenPenalty = burden.penalty + (slotStats[slot.id]?.burdenSignal ?? 0) * 0.1
          if (burden.level === 'high' && (tone === 'risk_framed' || tone === 'motivational')) {
            burdenPenalty += 0.35
          }

          const total =
            yesLikelihoodScore * 0.35 +
            duration.score * 0.25 +
            toneScore * 0.15 +
            contentScore * 0.15 +
            cohortPriorScoreValue * 0.1 +
            contextFitScore * 0.1 +
            learnedScore(tScore) * 0.05 -
            safetyPen -
            burdenPenalty

          if (total > bestTotal) {
            bestTotal = total
            const actionLabel = action.label.toLowerCase()
            const body = renderPromptTemplate(tone, {
              time: slot.label,
              action: actionLabel,
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
              safetyMode: safety.safetyMode,
              safetyReasons: safety.reasons,
              scoreBreakdown: {
                yesLikelihoodScore,
                expectedDurationScore: duration.score,
                toneScore,
                contentScore,
                cohortPriorScore: cohortPriorScoreValue,
                contextFitScore,
                timingScore: learnedScore(tScore),
                safetyPenalty: safetyPen,
                burdenPenalty,
                expectedDuration: duration.expectedDuration
                  ? Math.round(duration.expectedDuration * 10) / 10
                  : null,
                dataLimited,
                total,
              },
            }
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
    const body = renderPromptTemplate(tone, {
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
      safetyMode: safety.safetyMode,
      safetyReasons: ['Fallback: safest default prompt while filters were tight.'],
      scoreBreakdown: {
        yesLikelihoodScore: 0,
        expectedDurationScore: 0,
        toneScore: 0,
        contentScore: 0,
        cohortPriorScore: 0,
        contextFitScore: 0,
        timingScore: 0,
        safetyPenalty: 0,
        burdenPenalty: 0,
        expectedDuration: null,
        dataLimited: true,
        total: 0,
      },
    }
  }

  return best
}
