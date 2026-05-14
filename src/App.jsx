import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { TIME_SLOTS } from './data/timeSlots.js'
import { TONES } from './data/promptTemplates.js'
import { MICRO_ACTIONS, getMicroActionById } from './data/microActions.js'
import { getCohortById } from './data/cohortProfiles.js'
import { matchCohort, TIME_RANGE_OPTIONS } from './logic/coldStartEngine.js'
import { optimizePrompt } from './logic/promptOptimizer.js'
import { applyFeedbackToScores, DURATION_OPTIONS } from './logic/feedbackUpdater.js'
import { computeAnalytics } from './logic/analytics.js'
import {
  loadAppState,
  saveAppState,
  resetDemoData,
  TIME_RANGE_LABELS,
  BARRIER_LABELS,
  formatIdListForDisplay,
  MAIN_BARRIER_IDS,
} from './utils/storage.js'

const DISCLAIMER = 'Not medical advice.'

const DURATION_CHIP_LABEL = {
  '<1': '<1',
  '1-2': '1–2',
  '3-5': '3–5',
  '5-10': '5–10',
  '10+': '10+',
}

const BARRIER_SHORT = {
  lack_of_time: 'Time',
  fatigue: 'Fatigue',
  pain: 'Pain',
  low_motivation: 'Motivation',
  weather: 'Weather',
}

const TIME_WINDOW_SHORT = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  after_dinner: 'After dinner',
}

function toneLabel(tone) {
  return tone.replace(/_/g, ' ')
}

function topSlotsByScore(timingScores, limit = 8) {
  return [...TIME_SLOTS]
    .map((s) => ({ ...s, score: timingScores[s.id] ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function buildShortWhy(rec) {
  const b = rec?.scoreBreakdown
  if (rec?.safetyMode) return 'Safety mode keeps this suggestion lighter.'
  if (b && (b.cohortTerm ?? 0) > 0.4) return 'Aligned with your learned response pattern.'
  if (b && (b.contextTerm ?? 0) > 0.15) return 'Adjusted to fit today’s state.'
  return 'Best combined fit across time, tone, and action.'
}

function ScoreBar({ label, value, max }) {
  const v = Number(value) || 0
  const mx = Math.max(max, 0.01)
  const pct = Math.min(100, Math.max(0, (v / mx) * 100))
  return (
    <div className="amate-bar-row">
      <span className="amate-bar-label">{label}</span>
      <div className="amate-bar-track" role="presentation">
        <div className="amate-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="amate-bar-val">{v.toFixed(1)}</span>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState(loadAppState)
  const [awaitingDuration, setAwaitingDuration] = useState(false)

  useEffect(() => {
    saveAppState(state)
  }, [state])

  const analytics = useMemo(() => computeAnalytics(state), [state])

  const updateProfile = useCallback((patch) => {
    setState((s) => ({
      ...s,
      userProfile: { ...s.userProfile, ...patch },
    }))
  }, [])

  const toggleTimeRange = useCallback((id) => {
    setState((s) => {
      const cur = new Set(s.userProfile.preferredTimeRanges)
      if (cur.has(id)) {
        if (cur.size <= 1) return s
        cur.delete(id)
      } else {
        cur.add(id)
      }
      return {
        ...s,
        userProfile: { ...s.userProfile, preferredTimeRanges: [...cur] },
      }
    })
  }, [])

  const toggleBarrier = useCallback((id) => {
    setState((s) => {
      const cur = new Set(s.userProfile.mainBarriers)
      if (cur.has(id)) {
        if (cur.size <= 1) return s
        cur.delete(id)
      } else {
        cur.add(id)
      }
      return {
        ...s,
        userProfile: { ...s.userProfile, mainBarriers: [...cur] },
      }
    })
  }, [])

  const updateDaily = useCallback((patch) => {
    setState((s) => ({
      ...s,
      dailyContext: { ...s.dailyContext, ...patch },
    }))
  }, [])

  const saveProfileAndMatch = useCallback(() => {
    setState((s) => {
      const m = matchCohort(s.userProfile)
      return {
        ...s,
        matchedCohortId: m.cohortId,
        cohortMatchScore: m.matchScore,
      }
    })
  }, [])

  const generateRecommendation = useCallback(() => {
    setState((s) => {
      const cohortObj = s.matchedCohortId
        ? getCohortById(s.matchedCohortId)
        : matchCohort(s.userProfile).cohort
      const rec = optimizePrompt({
        userProfile: s.userProfile,
        dailyContext: s.dailyContext,
        matchedCohort: cohortObj,
        timingScores: s.timingScores,
        toneScores: s.toneScores,
        contentScores: s.contentScores,
        feedbackHistory: s.feedbackHistory,
      })
      const preferredTimeRangesText = formatIdListForDisplay(
        s.userProfile.preferredTimeRanges,
        TIME_RANGE_LABELS,
      )
      const mainBarriersText = formatIdListForDisplay(s.userProfile.mainBarriers, BARRIER_LABELS)
      return {
        ...s,
        lastRecommendation: {
          ...rec,
          createdAt: new Date().toISOString(),
          profileContextSummary: {
            preferredTimeRangesText,
            mainBarriersText,
          },
        },
      }
    })
    setAwaitingDuration(false)
  }, [])

  const pushFeedback = useCallback((response, durationBucket) => {
    setState((s) => {
      if (!s.lastRecommendation) return s
      const rec = s.lastRecommendation
      const scoreBefore = {
        timing: { ...s.timingScores },
        tone: { ...s.toneScores },
        content: { ...s.contentScores },
      }

      const next = applyFeedbackToScores(
        {
          timingScores: s.timingScores,
          toneScores: s.toneScores,
          contentScores: s.contentScores,
          durationStats: s.durationStats,
        },
        rec,
        response,
        durationBucket ?? null,
      )

      const event = {
        timestamp: new Date().toISOString(),
        response,
        durationBucket: durationBucket ?? null,
        dailyContext: { ...s.dailyContext },
        recommendation: {
          timeSlotId: rec.timeSlotId,
          tone: rec.tone,
          microActionId: rec.microActionId,
          suggestedDurationMinutes: rec.suggestedDurationMinutes,
        },
        scoreBefore,
        scoreAfter: {
          timing: { ...next.timingScores },
          tone: { ...next.toneScores },
          content: { ...next.contentScores },
        },
      }

      return {
        ...s,
        timingScores: next.timingScores,
        toneScores: next.toneScores,
        contentScores: next.contentScores,
        durationStats: next.durationStats,
        feedbackHistory: [event, ...s.feedbackHistory].slice(0, 80),
      }
    })
  }, [])

  const onYes = useCallback(() => {
    setAwaitingDuration(true)
  }, [])

  const onDurationPick = useCallback(
    (bucketId) => {
      pushFeedback('Yes', bucketId)
      setAwaitingDuration(false)
    },
    [pushFeedback],
  )

  const onNo = useCallback(() => {
    pushFeedback('No', null)
    setAwaitingDuration(false)
  }, [pushFeedback])

  const onSkip = useCallback(() => {
    pushFeedback('Skip', null)
    setAwaitingDuration(false)
  }, [pushFeedback])

  const cancelDuration = useCallback(() => {
    setAwaitingDuration(false)
  }, [])

  const onReset = useCallback(() => {
    setAwaitingDuration(false)
    setState(resetDemoData())
  }, [])

  const slotRows = useMemo(
    () => topSlotsByScore(state.timingScores, 8),
    [state.timingScores],
  )

  const maxSlot = useMemo(
    () => Math.max(...slotRows.map((r) => r.score ?? 0), 0.01),
    [slotRows],
  )

  const maxTone = useMemo(
    () => Math.max(...TONES.map((t) => state.toneScores[t] ?? 0), 0.01),
    [state.toneScores],
  )

  const maxContent = useMemo(
    () => Math.max(...MICRO_ACTIONS.map((a) => state.contentScores[a.id] ?? 0), 0.01),
    [state.contentScores],
  )

  const profileOneLine = useMemo(
    () =>
      [
        formatIdListForDisplay(state.userProfile.preferredTimeRanges, TIME_WINDOW_SHORT),
        formatIdListForDisplay(state.userProfile.mainBarriers, BARRIER_SHORT),
      ].join(' · '),
    [state.userProfile.preferredTimeRanges, state.userProfile.mainBarriers],
  )

  return (
    <div className="amate-shell">
      <div className="amate-app">
        <header className="amate-header">
          <h1 className="amate-title">Trigger Engine</h1>
          <p className="amate-tagline">Personalized prompts for your best moments.</p>
          <p className="amate-disclaimer">{DISCLAIMER}</p>
        </header>

        <div className="amate-top-grid">
          <section className="amate-card amate-form-card" aria-labelledby="profile-heading">
            <h2 id="profile-heading" className="amate-h2">
              You
            </h2>

            <fieldset className="amate-fieldset amate-fieldset-tight">
              <legend className="amate-legend">Friction</legend>
              <div className="amate-chip-row">
                {MAIN_BARRIER_IDS.map((id) => (
                  <label key={id} className="amate-chip">
                    <input
                      type="checkbox"
                      checked={state.userProfile.mainBarriers.includes(id)}
                      onChange={() => toggleBarrier(id)}
                    />
                    <span>{BARRIER_SHORT[id]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="amate-fieldset amate-fieldset-tight">
              <legend className="amate-legend">Windows</legend>
              <div className="amate-chip-row">
                {TIME_RANGE_OPTIONS.map((o) => (
                  <label key={o.id} className="amate-chip">
                    <input
                      type="checkbox"
                      checked={state.userProfile.preferredTimeRanges.includes(o.id)}
                      onChange={() => toggleTimeRange(o.id)}
                    />
                    <span>{TIME_WINDOW_SHORT[o.id] ?? o.id}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="amate-row-compact">
              <label className="amate-field-compact">
                <span className="amate-field-label">Confidence</span>
                <select
                  value={state.userProfile.baselineConfidence}
                  onChange={(e) => updateProfile({ baselineConfidence: e.target.value })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Med</option>
                  <option value="high">High</option>
                </select>
              </label>
              <fieldset className="amate-fieldset-inline">
                <legend className="amate-sr-only">Pain concern</legend>
                <span className="amate-field-label">Pain concern</span>
                <label className="amate-pill-radio">
                  <input
                    type="radio"
                    name="painConcern"
                    checked={state.userProfile.painConcern === 'yes'}
                    onChange={() => updateProfile({ painConcern: 'yes' })}
                  />
                  Yes
                </label>
                <label className="amate-pill-radio">
                  <input
                    type="radio"
                    name="painConcern"
                    checked={state.userProfile.painConcern === 'no'}
                    onChange={() => updateProfile({ painConcern: 'no' })}
                  />
                  No
                </label>
              </fieldset>
            </div>

            <label className="amate-field-compact amate-field-block">
              <span className="amate-field-label">Tone</span>
              <select
                value={state.userProfile.preferredTone}
                onChange={(e) => updateProfile({ preferredTone: e.target.value })}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {toneLabel(t)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="amate-btn-secondary amate-btn-wide"
              onClick={saveProfileAndMatch}
            >
              Save
            </button>
          </section>

          <section className="amate-card amate-form-card" aria-labelledby="daily-heading">
            <h2 id="daily-heading" className="amate-h2">
              State
            </h2>

            <div className="amate-row-compact amate-row-wrap">
              <label className="amate-field-compact">
                <span className="amate-field-label">Fatigue</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={state.dailyContext.fatigueToday}
                  onChange={(e) => updateDaily({ fatigueToday: Number(e.target.value) })}
                />
                <span className="amate-range-num">{state.dailyContext.fatigueToday}</span>
              </label>
              <label className="amate-field-compact">
                <span className="amate-field-label">Pain</span>
                <input
                  type="range"
                  min={0}
                  max={5}
                  value={state.dailyContext.painToday}
                  onChange={(e) => updateDaily({ painToday: Number(e.target.value) })}
                />
                <span className="amate-range-num">{state.dailyContext.painToday}</span>
              </label>
              <label className="amate-field-compact">
                <span className="amate-field-label">Motivation</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={state.dailyContext.motivationToday}
                  onChange={(e) => updateDaily({ motivationToday: Number(e.target.value) })}
                />
                <span className="amate-range-num">{state.dailyContext.motivationToday}</span>
              </label>
            </div>

            <div className="amate-row-compact">
              <label className="amate-field-compact">
                <span className="amate-field-label">Weather</span>
                <select
                  value={state.dailyContext.weather}
                  onChange={(e) => updateDaily({ weather: e.target.value })}
                >
                  <option value="good">Good</option>
                  <option value="bad">Bad</option>
                  <option value="not relevant">N/A</option>
                </select>
              </label>
              <label className="amate-field-compact">
                <span className="amate-field-label">Availability</span>
                <select
                  value={state.dailyContext.availabilityToday}
                  onChange={(e) => updateDaily({ availabilityToday: e.target.value })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Med</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
          </section>
        </div>

        <div className="amate-actions">
          <button type="button" className="amate-btn-primary" onClick={generateRecommendation}>
            Optimize
          </button>
        </div>

        {state.lastRecommendation && (
          <section className="amate-card amate-card-hero" aria-live="polite">
            <h2 className="amate-h2 amate-h2-center">Next</h2>

            <div className="amate-hero-kv">
              <div className="amate-kv">
                <span className="amate-k">Time</span>
                <span className="amate-pill amate-pill-strong">{state.lastRecommendation.timeSlotLabel}</span>
              </div>
              <div className="amate-kv">
                <span className="amate-k">Tone</span>
                <span className="amate-pill">{toneLabel(state.lastRecommendation.tone)}</span>
              </div>
              <div className="amate-kv">
                <span className="amate-k">Action</span>
                <span className="amate-pill">{state.lastRecommendation.microActionLabel}</span>
              </div>
              <div className="amate-kv">
                <span className="amate-k">Duration</span>
                <span className="amate-pill">{state.lastRecommendation.suggestedDurationMinutes} min</span>
              </div>
            </div>

            {state.lastRecommendation.safetyMode && (
              <p className="amate-safety-inline">Safety mode</p>
            )}

            <p className="amate-push-copy">Matched to your current rhythm.</p>

            <div className="amate-why">
              <span className="amate-why-label">Why</span>
              <p className="amate-why-text">{buildShortWhy(state.lastRecommendation)}</p>
            </div>

            {state.lastRecommendation.profileContextSummary && (
              <p className="amate-context-muted">
                {state.lastRecommendation.profileContextSummary.preferredTimeRangesText} ·{' '}
                {state.lastRecommendation.profileContextSummary.mainBarriersText}
              </p>
            )}

            <details className="amate-details-min">
              <summary>Details</summary>
              <p className="amate-detail-copy">{state.lastRecommendation.renderedPrompt}</p>
              {state.lastRecommendation.safetyReasons?.length > 0 && (
                <ul className="amate-safety-list-tight">
                  {state.lastRecommendation.safetyReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              <pre className="amate-pre-tight">
                {JSON.stringify(state.lastRecommendation.scoreBreakdown, null, 2)}
              </pre>
            </details>

            {!awaitingDuration && (
              <div className="amate-feedback-row">
                <button type="button" className="amate-btn-feedback amate-btn-yes" onClick={onYes}>
                  Yes
                </button>
                <button type="button" className="amate-btn-feedback" onClick={onNo}>
                  No
                </button>
                <button type="button" className="amate-btn-feedback amate-btn-skip" onClick={onSkip}>
                  Skip
                </button>
              </div>
            )}

            {awaitingDuration && (
              <div className="amate-followup">
                <p className="amate-followup-label">How long?</p>
                <div className="amate-duration-chips">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      className="amate-chip-btn"
                      onClick={() => onDurationPick(opt.id)}
                    >
                      {DURATION_CHIP_LABEL[opt.id] ?? opt.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="amate-btn-link" onClick={cancelDuration}>
                  Cancel
                </button>
              </div>
            )}
          </section>
        )}

        <section className="amate-card" aria-labelledby="dash-heading">
          <h2 id="dash-heading" className="amate-h2">
            Learning
          </h2>

          <p className="amate-profile-line">{profileOneLine}</p>

          <div className="amate-tiles">
            <div className="amate-tile">
              <span className="amate-tile-label">Cohort</span>
              <span className="amate-tile-value">{analytics.matchedCohortLabel}</span>
            </div>
            <div className="amate-tile">
              <span className="amate-tile-label">Level</span>
              <span className="amate-tile-value">{analytics.personalizationLevel}%</span>
            </div>
            <div className="amate-tile">
              <span className="amate-tile-label">Best time</span>
              <span className="amate-tile-value">{analytics.bestTimeSlot}</span>
            </div>
            <div className="amate-tile">
              <span className="amate-tile-label">Best tone</span>
              <span className="amate-tile-value">{toneLabel(analytics.bestTone)}</span>
            </div>
            <div className="amate-tile">
              <span className="amate-tile-label">Best action</span>
              <span className="amate-tile-value">
                {getMicroActionById(analytics.bestContent)?.label ?? analytics.bestContent}
              </span>
            </div>
            <div className="amate-tile">
              <span className="amate-tile-label">Avg min</span>
              <span className="amate-tile-value">
                {analytics.averageMovementDuration != null ? analytics.averageMovementDuration : '—'}
              </span>
            </div>
            <div className="amate-tile">
              <span className="amate-tile-label">Yes rate</span>
              <span className="amate-tile-value">{Math.round(analytics.yesRate * 100)}%</span>
            </div>
            <div className="amate-tile">
              <span className="amate-tile-label">Burden</span>
              <span className="amate-tile-value">{analytics.notificationBurdenLevel}</span>
            </div>
          </div>

          <h3 className="amate-h3">Timing</h3>
          <div className="amate-bars">
            {slotRows.map((row) => (
              <ScoreBar key={row.id} label={row.label} value={row.score} max={maxSlot} />
            ))}
          </div>

          <h3 className="amate-h3">Tone</h3>
          <div className="amate-bars">
            {TONES.map((t) => (
              <ScoreBar
                key={t}
                label={toneLabel(t)}
                value={state.toneScores[t] ?? 0}
                max={maxTone}
              />
            ))}
          </div>

          <h3 className="amate-h3">Action</h3>
          <div className="amate-bars">
            {MICRO_ACTIONS.map((a) => (
              <ScoreBar
                key={a.id}
                label={a.label}
                value={state.contentScores[a.id] ?? 0}
                max={maxContent}
              />
            ))}
          </div>

          {Object.keys(analytics.averageDurationBySlot).length > 0 && (
            <>
              <h3 className="amate-h3">Avg by slot</h3>
              <div className="amate-bars">
                {Object.entries(analytics.averageDurationBySlot)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([slotId, avg]) => (
                    <ScoreBar key={slotId} label={slotId} value={avg} max={15} />
                  ))}
              </div>
            </>
          )}

          <details className="amate-details-min">
            <summary>Actions reference</summary>
            <ul className="amate-micro-ref-tight">
              {MICRO_ACTIONS.map((a) => (
                <li key={a.id}>
                  <strong>{a.label}</strong> — {a.description}
                </li>
              ))}
            </ul>
          </details>

          <h3 className="amate-h3">History</h3>
          {state.feedbackHistory.length === 0 ? (
            <p className="amate-muted">None yet.</p>
          ) : (
            <ul className="amate-history-tight">
              {state.feedbackHistory.slice(0, 5).map((ev, idx) => (
                <li key={`${ev.timestamp}-${idx}`}>
                  <span className="amate-history-date">
                    {new Date(ev.timestamp).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="amate-history-meta">
                    {ev.response}
                    {ev.durationBucket ? ` · ${DURATION_CHIP_LABEL[ev.durationBucket] ?? ev.durationBucket}` : ''}{' '}
                    · {ev.recommendation.timeSlotId}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="amate-footer">
          <button type="button" className="amate-btn-reset" onClick={onReset}>
            Reset
          </button>
        </footer>
      </div>
    </div>
  )
}
