import { TIME_SLOTS, getSlotById, slotMatchesNamedRange } from '../data/timeSlots.js'
import { TONES, renderPromptTemplate } from '../data/promptTemplates.js'
import { MICRO_ACTIONS, getMicroActionById } from '../data/microActions.js'
import { evaluateSafety } from './safetyFilter.js'
import { computeBurden } from './burdenScorer.js'

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

function normalizeResponse(response) {
  const value = String(response ?? '').toLowerCase()
  if (value === 'done') return 'yes'
  return value
}

function responseStats(feedbackHistory) {
  const bySlot = {}
  const byTone = {}
  const byContent = {}
  for (const row of feedbackHistory ?? []) {
    const response = normalizeResponse(row.response)
    const slot = row.timeSlot ?? row.recommendation?.timeSlotId
    const tone = row.tone ?? row.recommendation?.tone
    const content = row.content ?? row.action ?? row.recommendation?.microActionId
    for (const [map, key] of [
      [bySlot, slot],
      [byTone, tone],
      [byContent, content],
    ]) {
      if (!key) continue
      map[key] = map[key] ?? { yes: 0, total: 0 }
      if (response === 'yes') map[key].yes += 1
      if (response === 'yes' || response === 'no' || response === 'skip') map[key].total += 1
    }
  }
  return { bySlot, byTone, byContent }
}

function yesRateTerm(stats, key) {
  const row = stats[key]
  if (!row?.total) return 0
  const confidence = Math.min(1, row.total / 5)
  return ((row.yes / row.total) - 0.5) * confidence * 1.2
}

function averageDurationCell(cell) {
  if (!cell?.count) return 0
  return cell.sum / cell.count
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
          const prefBias = userPreferredSlotBonuses(userProfile, slot.id)
          const yesLikelihoodTerm =
            yesRateTerm(behavior.bySlot, slot.id) +
            yesRateTerm(behavior.byTone, tone) * 0.5 +
            yesRateTerm(behavior.byContent, action.id) * 0.5
          const slotAvg = averageDurationCell(durationStats?.bySlot?.[slot.id])
          const contentAvg = averageDurationCell(durationStats?.byContent?.[action.id])
          const expectedDuration = slotAvg && contentAvg
            ? (slotAvg + contentAvg) / 2
            : slotAvg || contentAvg
          const durationTerm = expectedDuration ? Math.min(1.2, (expectedDuration / 10) * 1.2) : 0

          const timingTerm = 1.0 * tScore
          const toneTerm = 1.0 * tnScore
          const contentTerm = 1.0 * cScore
          const cohortTerm = 1.2 * cohortP
          const contextTerm = 1.0 * ctxFit + prefBias
          const safetyPen = safety.safetyPenalty + (safety.safetyMode ? 0.15 : 0)
          let burdenPenalty = burden.penalty
          if (burden.level === 'high' && (tone === 'risk_framed' || tone === 'motivational')) {
            burdenPenalty += 0.35
          }

          const total =
            timingTerm +
            toneTerm +
            contentTerm +
            cohortTerm +
            contextTerm -
            safetyPen -
            burdenPenalty +
            yesLikelihoodTerm +
            durationTerm

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
                timingTerm,
                toneTerm,
                contentTerm,
                cohortTerm,
                contextTerm,
                safetyPenalty: safetyPen,
                burdenPenalty,
                yesLikelihoodTerm,
                durationTerm,
                expectedDuration: expectedDuration ? Math.round(expectedDuration * 10) / 10 : null,
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
        timingTerm: 0,
        toneTerm: 0,
        contentTerm: 0,
        cohortTerm: 0,
        contextTerm: 0,
        safetyPenalty: 0,
        burdenPenalty: 0,
        yesLikelihoodTerm: 0,
        durationTerm: 0,
        expectedDuration: null,
        total: 0,
      },
    }
  }

  return best
}
