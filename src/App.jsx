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

const DISCLAIMER =
  'This prototype supports behavior change prompt optimization and is not medical advice.'

function toneLabel(tone) {
  return tone.replace(/_/g, ' ')
}

function topSlotsByScore(timingScores, limit = 12) {
  return [...TIME_SLOTS]
    .map((s) => ({ ...s, score: timingScores[s.id] ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
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
    () => topSlotsByScore(state.timingScores, 14),
    [state.timingScores],
  )

  return (
    <div className="amate-app">
      <header className="amate-header">
        <h1>Adaptive push prompt optimization (demo)</h1>
        <p className="amate-subtitle">
          This prototype picks a <strong>push notification</strong> time, tone, micro-action,
          and suggested duration using transparent rules and your feedback. Nothing here calls
          an external AI service.
        </p>
        <p className="amate-disclaimer">{DISCLAIMER}</p>
      </header>

      <section className="amate-card" aria-labelledby="profile-heading">
        <h2 id="profile-heading">User profile</h2>
        <p className="amate-hint">
          Used for cold-start cohort matching and prompt scoring. Tap &quot;Save profile &amp;
          match cohort&quot; after edits.
        </p>

        <fieldset className="amate-fieldset">
          <legend>Main barriers (select all that apply)</legend>
          <p className="amate-hint amate-hint-tight">
            Selected:{' '}
            <span className="amate-selection-summary">
              {formatIdListForDisplay(state.userProfile.mainBarriers, BARRIER_LABELS)}
            </span>
          </p>
          <div className="amate-chip-row">
            {MAIN_BARRIER_IDS.map((id) => (
              <label key={id} className="amate-chip">
                <input
                  type="checkbox"
                  checked={state.userProfile.mainBarriers.includes(id)}
                  onChange={() => toggleBarrier(id)}
                />
                <span>{BARRIER_LABELS[id]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="amate-fieldset">
          <legend>Preferred time windows (select all that apply)</legend>
          <p className="amate-hint amate-hint-tight">
            Preferred time ranges:{' '}
            <span className="amate-selection-summary">
              {formatIdListForDisplay(state.userProfile.preferredTimeRanges, TIME_RANGE_LABELS)}
            </span>
          </p>
          <div className="amate-chip-row">
            {TIME_RANGE_OPTIONS.map((o) => (
              <label key={o.id} className="amate-chip">
                <input
                  type="checkbox"
                  checked={state.userProfile.preferredTimeRanges.includes(o.id)}
                  onChange={() => toggleTimeRange(o.id)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="amate-label">
          Baseline confidence
          <select
            value={state.userProfile.baselineConfidence}
            onChange={(e) => updateProfile({ baselineConfidence: e.target.value })}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>

        <fieldset className="amate-fieldset">
          <legend>Pain concern</legend>
          <label className="amate-inline">
            <input
              type="radio"
              name="painConcern"
              checked={state.userProfile.painConcern === 'yes'}
              onChange={() => updateProfile({ painConcern: 'yes' })}
            />
            yes
          </label>
          <label className="amate-inline">
            <input
              type="radio"
              name="painConcern"
              checked={state.userProfile.painConcern === 'no'}
              onChange={() => updateProfile({ painConcern: 'no' })}
            />
            no
          </label>
        </fieldset>

        <label className="amate-label">
          Preferred starting tone
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

        <button type="button" className="amate-btn-secondary amate-btn-wide" onClick={saveProfileAndMatch}>
          Save profile &amp; match cohort
        </button>
      </section>

      <section className="amate-card" aria-labelledby="daily-heading">
        <h2 id="daily-heading">Daily context check-in</h2>
        <p className="amate-hint">Adjust anytime before generating a new recommendation.</p>

        <label className="amate-label">
          Fatigue today (1–5)
          <input
            type="range"
            min={1}
            max={5}
            value={state.dailyContext.fatigueToday}
            onChange={(e) => updateDaily({ fatigueToday: Number(e.target.value) })}
          />
          <span className="amate-range-value">{state.dailyContext.fatigueToday}</span>
        </label>

        <label className="amate-label">
          Pain today (0–5)
          <input
            type="range"
            min={0}
            max={5}
            value={state.dailyContext.painToday}
            onChange={(e) => updateDaily({ painToday: Number(e.target.value) })}
          />
          <span className="amate-range-value">{state.dailyContext.painToday}</span>
        </label>

        <label className="amate-label">
          Motivation today (1–5)
          <input
            type="range"
            min={1}
            max={5}
            value={state.dailyContext.motivationToday}
            onChange={(e) => updateDaily({ motivationToday: Number(e.target.value) })}
          />
          <span className="amate-range-value">{state.dailyContext.motivationToday}</span>
        </label>

        <label className="amate-label">
          Weather
          <select
            value={state.dailyContext.weather}
            onChange={(e) => updateDaily({ weather: e.target.value })}
          >
            <option value="good">good</option>
            <option value="bad">bad</option>
            <option value="not relevant">not relevant</option>
          </select>
        </label>

        <label className="amate-label">
          Availability today
          <select
            value={state.dailyContext.availabilityToday}
            onChange={(e) => updateDaily({ availabilityToday: e.target.value })}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
      </section>

      <section className="amate-card amate-actions">
        <button type="button" className="amate-btn-primary" onClick={generateRecommendation}>
          Generate recommended push prompt
        </button>
      </section>

      {state.lastRecommendation && (
        <section className="amate-card amate-result" aria-live="polite">
          <h2>Recommended prompt (push)</h2>
          {state.lastRecommendation.profileContextSummary && (
            <div className="amate-context-lines" role="note">
              <p>
                <strong>Preferred time ranges:</strong>{' '}
                {state.lastRecommendation.profileContextSummary.preferredTimeRangesText}
              </p>
              <p>
                <strong>Selected barriers:</strong>{' '}
                {state.lastRecommendation.profileContextSummary.mainBarriersText}
              </p>
            </div>
          )}
          <div className="amate-push-meta">
            <span className="amate-badge">{state.lastRecommendation.timeSlotLabel}</span>
            <span className="amate-badge amate-tone">{toneLabel(state.lastRecommendation.tone)}</span>
            <span className="amate-badge">{state.lastRecommendation.microActionLabel}</span>
            <span className="amate-badge">
              ~{state.lastRecommendation.suggestedDurationMinutes} min suggested
            </span>
            {state.lastRecommendation.safetyMode && (
              <span className="amate-badge amate-safety">Safety mode</span>
            )}
          </div>
          <p className="amate-push-body">{state.lastRecommendation.renderedPrompt}</p>
          {state.lastRecommendation.safetyReasons?.length > 0 && (
            <ul className="amate-safety-list">
              {state.lastRecommendation.safetyReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <details className="amate-details">
            <summary>Score breakdown (transparent)</summary>
            <pre className="amate-pre">
              {JSON.stringify(state.lastRecommendation.scoreBreakdown, null, 2)}
            </pre>
          </details>

          {!awaitingDuration && (
            <div className="amate-feedback-row">
              <button type="button" className="amate-btn-yes" onClick={onYes}>
                Yes
              </button>
              <button type="button" className="amate-btn-secondary" onClick={onNo}>
                No
              </button>
              <button type="button" className="amate-btn-secondary" onClick={onSkip}>
                Skip
              </button>
            </div>
          )}

          {awaitingDuration && (
            <div className="amate-followup">
              <p className="amate-feedback-label">How long did you move?</p>
              <div className="amate-duration-grid">
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.id}
                    className="amate-btn-secondary"
                    onClick={() => onDurationPick(opt.id)}
                  >
                    {opt.label}
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
        <h2 id="dash-heading">Personalization dashboard</h2>

        <div className="amate-profile-banner">
          <p>
            <strong>Preferred time ranges:</strong>{' '}
            {formatIdListForDisplay(state.userProfile.preferredTimeRanges, TIME_RANGE_LABELS)}
          </p>
          <p>
            <strong>Selected barriers:</strong>{' '}
            {formatIdListForDisplay(state.userProfile.mainBarriers, BARRIER_LABELS)}
          </p>
        </div>

        <div className="amate-dash-grid">
          <div className="amate-stat">
            <h3>Matched cohort</h3>
            <p className="amate-big">{analytics.matchedCohortLabel}</p>
            <p className="amate-muted amate-small">
              Match score: {analytics.cohortMatchScore} (internal similarity score for the demo)
            </p>
          </div>
          <div className="amate-stat">
            <h3>Personalization level</h3>
            <p className="amate-big">{analytics.personalizationLevel}%</p>
            <p className="amate-muted amate-small">Grows with feedback volume and score spread.</p>
          </div>
          <div className="amate-stat">
            <h3>Responses</h3>
            <p className="amate-small">
              Yes {Math.round(analytics.yesRate * 100)}% · No {Math.round(analytics.noRate * 100)}%
              · Skip {Math.round(analytics.skipRate * 100)}%
            </p>
            <p className="amate-muted amate-small">n = {analytics.feedbackCount}</p>
          </div>
          <div className="amate-stat">
            <h3>Notification burden</h3>
            <p className="amate-big">{analytics.notificationBurdenLevel}</p>
            <p className="amate-muted amate-small">
              Recent No/Skip rate: {Math.round(analytics.notificationBurdenRate * 100)}%
            </p>
          </div>
        </div>

        <div className="amate-stat amate-stat-span">
          <h3>Average movement duration (self-reported after Yes)</h3>
          <p className="amate-big">
            {analytics.averageMovementDuration != null
              ? `${analytics.averageMovementDuration} min (midpoint estimate)`
              : '—'}
          </p>
        </div>

        <div className="amate-triple">
          <div className="amate-stat">
            <h3>Best time slot (scores)</h3>
            <p className="amate-big">{analytics.bestTimeSlot}</p>
            <p className="amate-muted amate-mono">{analytics.bestTimeSlotScore}</p>
          </div>
          <div className="amate-stat">
            <h3>Best tone</h3>
            <p className="amate-big">{toneLabel(analytics.bestTone)}</p>
            <p className="amate-muted amate-mono">{analytics.bestToneScore}</p>
          </div>
          <div className="amate-stat">
            <h3>Best content</h3>
            <p className="amate-big">
              {getMicroActionById(analytics.bestContent)?.label ?? analytics.bestContent}
            </p>
            <p className="amate-muted amate-mono">{analytics.bestContentScore}</p>
          </div>
        </div>

        <h3 className="amate-history-title">Timing scores (top slots)</h3>
        <ul className="amate-slot-list">
          {slotRows.map((row) => (
            <li key={row.id}>
              <span>{row.label}</span>
              <span className="amate-mono">{(row.score ?? 0).toFixed(2)}</span>
            </li>
          ))}
        </ul>

        <h3 className="amate-history-title">Tone scores</h3>
        <ul className="amate-score-list">
          {TONES.map((t) => (
            <li key={t}>
              <span>{toneLabel(t)}</span>
              <span className="amate-mono">{(state.toneScores[t] ?? 0).toFixed(2)}</span>
            </li>
          ))}
        </ul>

        <h3 className="amate-history-title">Content scores</h3>
        <ul className="amate-score-list">
          {MICRO_ACTIONS.map((a) => (
            <li key={a.id}>
              <span>{a.label}</span>
              <span className="amate-mono">{(state.contentScores[a.id] ?? 0).toFixed(2)}</span>
            </li>
          ))}
        </ul>

        <h3 className="amate-history-title">Average duration by time slot (where reported)</h3>
        {Object.keys(analytics.averageDurationBySlot).length === 0 ? (
          <p className="amate-muted">No duration answers yet.</p>
        ) : (
          <ul className="amate-score-list">
            {Object.entries(analytics.averageDurationBySlot)
              .sort((a, b) => b[1] - a[1])
              .map(([slotId, avg]) => (
                <li key={slotId}>
                  <span>{slotId}</span>
                  <span className="amate-mono">{avg} min</span>
                </li>
              ))}
          </ul>
        )}

        <h3 className="amate-history-title">Micro-action reference</h3>
        <ul className="amate-micro-ref">
          {MICRO_ACTIONS.map((a) => (
            <li key={a.id}>
              <strong>{a.label}</strong> — {a.description} (default ~{a.defaultDuration} min,{' '}
              {a.intensity})
            </li>
          ))}
        </ul>

        <h3 className="amate-history-title">Recent feedback</h3>
        {state.feedbackHistory.length === 0 ? (
          <p className="amate-muted">No feedback yet.</p>
        ) : (
          <ul className="amate-history">
            {state.feedbackHistory.slice(0, 10).map((ev, idx) => (
              <li key={`${ev.timestamp}-${idx}`}>
                <span className="amate-mono">{new Date(ev.timestamp).toLocaleString()}</span>
                {' — '}
                <strong>{ev.response}</strong>
                {ev.durationBucket ? ` (${ev.durationBucket})` : ''} @ {ev.recommendation.timeSlotId}{' '}
                / {toneLabel(ev.recommendation.tone)} / {ev.recommendation.microActionId}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="amate-footer">
        <button type="button" className="amate-btn-danger" onClick={onReset}>
          Reset demo data
        </button>
      </footer>
    </div>
  )
}
