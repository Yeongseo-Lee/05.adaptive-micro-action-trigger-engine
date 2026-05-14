import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE = {
  userProfile: 'userProfile',
  dailyContext: 'dailyContext',
  timingScores: 'timingScores',
  feedbackHistory: 'feedbackHistory',
  lastRecommendation: 'lastRecommendation',
}

const TIME_WINDOWS = ['morning', 'afternoon', 'evening', 'after dinner']

const BARRIERS = [
  'lack of time',
  'fatigue',
  'pain',
  'low motivation',
  'weather',
  'other',
]

const MICRO_ACTION_PROMPTS = [
  'When this time window arrives, try two minutes of gentle indoor walking.',
  'When this time window arrives, stand up and move lightly for two minutes.',
  'When this time window arrives, try two minutes of gentle stretching.',
  'When this time window arrives, take two minutes for slow breathing while seated comfortably.',
  'When this time window arrives, do two minutes of easy shoulder rolls and neck movements.',
]

const SAFETY_NOTE_DEFAULT =
  'Use comfortable effort only. You can shorten the activity or skip it if needed.'

const SAFETY_NOTE_ACTIVE =
  'Safety mode is on: keep effort very light, stay supported if needed, and stop if you notice increased discomfort.'

const DISCLAIMER =
  'This prototype supports behavior change timing personalization and is not medical advice.'

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function defaultUserProfile() {
  return {
    preferredTimeWindows: [],
    mainBarrier: 'lack of time',
    baselineConfidence: 'medium',
    preferredPromptFrequency: 'once per day',
    painConcern: 'no',
  }
}

function defaultDailyContext() {
  return {
    fatigueToday: 3,
    painToday: 0,
    motivationToday: 3,
    weather: 'not relevant',
    availabilityToday: 'medium',
  }
}

function defaultTimingScores() {
  return {
    morning: 0,
    afternoon: 0,
    evening: 0,
    'after dinner': 0,
  }
}

function promptForWindow(window) {
  let h = 0
  for (let i = 0; i < window.length; i++) h = (h + window.charCodeAt(i) * (i + 1)) % 997
  return MICRO_ACTION_PROMPTS[h % MICRO_ACTION_PROMPTS.length]
}

function nextWindow(window) {
  const i = TIME_WINDOWS.indexOf(window)
  if (i < 0 || i >= TIME_WINDOWS.length - 1) return null
  return TIME_WINDOWS[i + 1]
}

/** @param {Record<string, number>} scores */
function bestWindowFromScores(scores) {
  let best = TIME_WINDOWS[0]
  let bestVal = scores[best] ?? -Infinity
  for (const w of TIME_WINDOWS) {
    const v = scores[w] ?? 0
    if (v > bestVal) {
      bestVal = v
      best = w
    }
  }
  return best
}

/** Prefer preferred windows on ties; otherwise earliest in the day order. */
function pickBestAmongCandidates(scores, candidates, preferred) {
  const pref = preferred instanceof Set ? preferred : new Set(preferred || [])
  let bestVal = -Infinity
  const tied = []
  for (const w of candidates) {
    const v = scores[w] ?? 0
    if (v > bestVal) {
      bestVal = v
      tied.length = 0
      tied.push(w)
    } else if (v === bestVal) {
      tied.push(w)
    }
  }
  if (tied.length === 1) return tied[0]
  const preferredTied = tied.filter((w) => pref.has(w))
  const pool = preferredTied.length > 0 ? preferredTied : tied
  return [...pool].sort((a, b) => TIME_WINDOWS.indexOf(a) - TIME_WINDOWS.indexOf(b))[0]
}

/**
 * Transparent scoring for recommendation.
 * @returns {{ scores: Record<string, number>, safetyMode: boolean, explanationParts: string[] }}
 */
function computeRecommendationScores(userProfile, dailyContext, timingScores) {
  const explanationParts = []
  const painHigh = dailyContext.painToday >= 4
  const fatigueHigh = dailyContext.fatigueToday >= 4
  const preferred = new Set(userProfile.preferredTimeWindows || [])
  const availabilityLow = dailyContext.availabilityToday === 'low'

  const scores = {}
  for (const w of TIME_WINDOWS) {
    let s = 1
    explanationParts.push(`${w}: base 1`)

    if (preferred.has(w)) {
      s += 1
      explanationParts.push(`${w}: +1 (in your preferred time windows)`)
    }

    const feedbackScore = timingScores[w] ?? 0
    if (feedbackScore !== 0) {
      s += feedbackScore
      explanationParts.push(
        `${w}: ${feedbackScore >= 0 ? '+' : ''}${feedbackScore} (net from your past feedback in timing scores)`,
      )
    }

    if (fatigueHigh && (w === 'morning' || w === 'afternoon')) {
      s -= 0.5
      explanationParts.push(`${w}: −0.5 (fatigue today is on the higher side)`)
    }

    scores[w] = s
  }

  if (painHigh) {
    for (const w of TIME_WINDOWS) {
      scores[w] -= 0.2
      explanationParts.push(
        `${w}: −0.2 (pain today is higher; scores are softened to reduce timing sharpness)`,
      )
    }
    explanationParts.push(
      'Safety mode: pain today is on the higher side, so wording is gentler and scores are slightly softened.',
    )
  }

  let candidates = TIME_WINDOWS
  if (availabilityLow && preferred.size > 0) {
    candidates = TIME_WINDOWS.filter((w) => preferred.has(w))
    explanationParts.push(
      'Availability today is low, so only your preferred time windows were considered for the final pick.',
    )
  } else if (availabilityLow && preferred.size === 0) {
    explanationParts.push(
      'Availability today is low, but no preferred windows were saved, so all windows stayed in the running.',
    )
  }

  const winner = pickBestAmongCandidates(scores, candidates, preferred)

  if (painHigh && userProfile.preferredPromptFrequency === 'twice per day') {
    explanationParts.push(
      'Your saved frequency preference (twice per day) is noted; with higher pain today, the demo still shows one timing pick and keeps expectations light.',
    )
  }

  if (userProfile.painConcern === 'yes') {
    explanationParts.push(
      'You indicated a pain concern in your profile; the safety note stays extra cautious even when the pain slider is lower.',
    )
  }

  return {
    scores,
    safetyMode: painHigh,
    explanationParts,
    recommendedWindow: winner,
  }
}

function formatScores(scores) {
  return TIME_WINDOWS.map((w) => `${w}: ${(scores[w] ?? 0).toFixed(2)}`).join(' · ')
}

export default function App() {
  const [userProfile, setUserProfile] = useState(defaultUserProfile)
  const [dailyContext, setDailyContext] = useState(defaultDailyContext)
  const [timingScores, setTimingScores] = useState(defaultTimingScores)
  const [feedbackHistory, setFeedbackHistory] = useState([])
  const [lastRecommendation, setLastRecommendation] = useState(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setUserProfile(loadJson(STORAGE.userProfile, defaultUserProfile()))
    setDailyContext(loadJson(STORAGE.dailyContext, defaultDailyContext()))
    setTimingScores(loadJson(STORAGE.timingScores, defaultTimingScores()))
    setFeedbackHistory(loadJson(STORAGE.feedbackHistory, []))
    let lr = loadJson(STORAGE.lastRecommendation, null)
    if (lr && lr.painFeedbackSticky === undefined && lr.safetyModeFromPainFeedback) {
      lr = { ...lr, painFeedbackSticky: true }
    }
    setLastRecommendation(lr)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveJson(STORAGE.userProfile, userProfile)
  }, [userProfile, hydrated])

  useEffect(() => {
    if (!hydrated) return
    saveJson(STORAGE.dailyContext, dailyContext)
  }, [dailyContext, hydrated])

  useEffect(() => {
    if (!hydrated) return
    saveJson(STORAGE.timingScores, timingScores)
  }, [timingScores, hydrated])

  useEffect(() => {
    if (!hydrated) return
    saveJson(STORAGE.feedbackHistory, feedbackHistory)
  }, [feedbackHistory, hydrated])

  useEffect(() => {
    if (!hydrated) return
    if (lastRecommendation === null) {
      localStorage.removeItem(STORAGE.lastRecommendation)
    } else {
      saveJson(STORAGE.lastRecommendation, lastRecommendation)
    }
  }, [lastRecommendation, hydrated])

  const safetyModeActive = useMemo(() => {
    const painTodayHigh = dailyContext.painToday >= 4
    const sticky = lastRecommendation?.painFeedbackSticky === true
    const painConcern = userProfile.painConcern === 'yes'
    return painTodayHigh || sticky || painConcern
  }, [dailyContext.painToday, lastRecommendation, userProfile.painConcern])

  const updateProfileField = useCallback((field, value) => {
    setUserProfile((p) => ({ ...p, [field]: value }))
  }, [])

  const togglePreferredWindow = useCallback((window) => {
    setUserProfile((p) => {
      const set = new Set(p.preferredTimeWindows || [])
      if (set.has(window)) set.delete(window)
      else set.add(window)
      return { ...p, preferredTimeWindows: [...set] }
    })
  }, [])

  const updateDailyField = useCallback((field, value) => {
    setDailyContext((c) => ({ ...c, [field]: value }))
  }, [])

  const generateRecommendation = useCallback(() => {
    setLastRecommendation((prev) => {
      const sticky = prev?.painFeedbackSticky === true
      const { scores, safetyMode, explanationParts, recommendedWindow } =
        computeRecommendationScores(userProfile, dailyContext, timingScores)

      const winner = recommendedWindow
      const painConcern = userProfile.painConcern === 'yes'
      const strongSafety = safetyMode || sticky || painConcern

      const explanation = [
        'How this time was chosen (transparent steps):',
        ...explanationParts,
        `Among eligible windows, "${winner}" had the highest combined score (ties favor a preferred window, then earlier in the day).`,
      ].join('\n')

      return {
        recommendedTimeWindow: winner,
        microActionPrompt: promptForWindow(winner),
        safetyNote: strongSafety ? SAFETY_NOTE_ACTIVE : SAFETY_NOTE_DEFAULT,
        explanation,
        scoreSnapshot: { ...scores },
        painFeedbackSticky: sticky,
        createdAt: new Date().toISOString(),
      }
    })
  }, [userProfile, dailyContext, timingScores])

  const appendFeedback = useCallback(
    (response) => {
      if (!lastRecommendation?.recommendedTimeWindow) return

      const window = lastRecommendation.recommendedTimeWindow
      const scoreBefore = { ...timingScores }
      const explanation = lastRecommendation.explanation || ''

      const nextScores = { ...timingScores }
      const lw = nextWindow(window)

      if (response === 'Did it') nextScores[window] = (nextScores[window] ?? 0) + 2
      else if (response === 'Partially did it')
        nextScores[window] = (nextScores[window] ?? 0) + 1
      else if (response === 'Skip') nextScores[window] = (nextScores[window] ?? 0) - 1
      else if (response === 'Later') {
        nextScores[window] = (nextScores[window] ?? 0) - 0.5
        if (lw) nextScores[lw] = (nextScores[lw] ?? 0) + 1
      } else if (response === 'Too tired')
        nextScores[window] = (nextScores[window] ?? 0) - 1
      else if (response === 'Pain/discomfort')
        nextScores[window] = (nextScores[window] ?? 0) - 1

      const scoreAfter = { ...nextScores }

      const event = {
        timestamp: new Date().toISOString(),
        recommendedTimeWindow: window,
        response,
        dailyContext: { ...dailyContext },
        scoreBefore,
        scoreAfter,
        explanation,
      }

      setTimingScores(nextScores)
      setFeedbackHistory((hist) => [event, ...hist].slice(0, 50))

      const painFeedback = response === 'Pain/discomfort'
      const clearSticky = response === 'Did it' || response === 'Partially did it'
      const sticky = clearSticky ? false : painFeedback ? true : lastRecommendation.painFeedbackSticky === true

      const painTodayHigh = dailyContext.painToday >= 4
      const painConcern = userProfile.painConcern === 'yes'
      const strongSafety = painTodayHigh || sticky || painConcern

      setLastRecommendation((lr) =>
        lr
          ? {
              ...lr,
              painFeedbackSticky: sticky,
              safetyNote: strongSafety ? SAFETY_NOTE_ACTIVE : SAFETY_NOTE_DEFAULT,
            }
          : lr,
      )
    },
    [lastRecommendation, dailyContext, timingScores, userProfile.painConcern],
  )

  const resetDemo = useCallback(() => {
    const p = defaultUserProfile()
    const d = defaultDailyContext()
    const t = defaultTimingScores()
    setUserProfile(p)
    setDailyContext(d)
    setTimingScores(t)
    setFeedbackHistory([])
    setLastRecommendation(null)
    saveJson(STORAGE.userProfile, p)
    saveJson(STORAGE.dailyContext, d)
    saveJson(STORAGE.timingScores, t)
    saveJson(STORAGE.feedbackHistory, [])
    localStorage.removeItem(STORAGE.lastRecommendation)
  }, [])

  const bestWindow = useMemo(
    () => bestWindowFromScores(timingScores),
    [timingScores],
  )

  const bestScore = timingScores[bestWindow] ?? 0

  if (!hydrated) {
    return (
      <div className="amate-app amate-loading">
        <p>Loading your demo data…</p>
      </div>
    )
  }

  return (
    <div className="amate-app">
      <header className="amate-header">
        <h1>Adaptive Micro-Action Trigger Engine</h1>
        <p className="amate-subtitle">
          A demo that personalizes <strong>when</strong> a small activity prompt might fit
          your day. The text of the prompts is fixed; only timing and scores adapt from your
          inputs and feedback.
        </p>
        <p className="amate-disclaimer">{DISCLAIMER}</p>
      </header>

      <section className="amate-card" aria-labelledby="profile-heading">
        <h2 id="profile-heading">Your profile</h2>
        <p className="amate-hint">Used to bias timing toward windows that fit you.</p>

        <fieldset className="amate-fieldset">
          <legend>Preferred time windows</legend>
          <div className="amate-chip-row">
            {TIME_WINDOWS.map((w) => (
              <label key={w} className="amate-chip">
                <input
                  type="checkbox"
                  checked={userProfile.preferredTimeWindows?.includes(w) ?? false}
                  onChange={() => togglePreferredWindow(w)}
                />
                <span>{w}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="amate-label">
          Main barrier today (for context in explanations)
          <select
            value={userProfile.mainBarrier}
            onChange={(e) => updateProfileField('mainBarrier', e.target.value)}
          >
            {BARRIERS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="amate-label">
          Baseline confidence
          <select
            value={userProfile.baselineConfidence}
            onChange={(e) => updateProfileField('baselineConfidence', e.target.value)}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>

        <label className="amate-label">
          Preferred prompt frequency
          <select
            value={userProfile.preferredPromptFrequency}
            onChange={(e) =>
              updateProfileField('preferredPromptFrequency', e.target.value)
            }
          >
            <option value="once per day">once per day</option>
            <option value="twice per day">twice per day</option>
          </select>
        </label>

        <fieldset className="amate-fieldset">
          <legend>Pain concern</legend>
          <label className="amate-inline">
            <input
              type="radio"
              name="painConcern"
              checked={userProfile.painConcern === 'yes'}
              onChange={() => updateProfileField('painConcern', 'yes')}
            />
            yes
          </label>
          <label className="amate-inline">
            <input
              type="radio"
              name="painConcern"
              checked={userProfile.painConcern === 'no'}
              onChange={() => updateProfileField('painConcern', 'no')}
            />
            no
          </label>
        </fieldset>
      </section>

      <section className="amate-card" aria-labelledby="daily-heading">
        <h2 id="daily-heading">Today&apos;s context</h2>
        <p className="amate-hint">Update this whenever you want a fresh recommendation.</p>

        <label className="amate-label">
          Fatigue today (1 = low, 5 = high)
          <input
            type="range"
            min={1}
            max={5}
            value={dailyContext.fatigueToday}
            onChange={(e) =>
              updateDailyField('fatigueToday', Number(e.target.value))
            }
          />
          <span className="amate-range-value">{dailyContext.fatigueToday}</span>
        </label>

        <label className="amate-label">
          Pain today (0 = none, 5 = high)
          <input
            type="range"
            min={0}
            max={5}
            value={dailyContext.painToday}
            onChange={(e) => updateDailyField('painToday', Number(e.target.value))}
          />
          <span className="amate-range-value">{dailyContext.painToday}</span>
        </label>

        <label className="amate-label">
          Motivation today (1 = low, 5 = high)
          <input
            type="range"
            min={1}
            max={5}
            value={dailyContext.motivationToday}
            onChange={(e) =>
              updateDailyField('motivationToday', Number(e.target.value))
            }
          />
          <span className="amate-range-value">{dailyContext.motivationToday}</span>
        </label>

        <label className="amate-label">
          Weather
          <select
            value={dailyContext.weather}
            onChange={(e) => updateDailyField('weather', e.target.value)}
          >
            <option value="good">good</option>
            <option value="bad">bad</option>
            <option value="not relevant">not relevant</option>
          </select>
        </label>

        <label className="amate-label">
          Availability today
          <select
            value={dailyContext.availabilityToday}
            onChange={(e) =>
              updateDailyField('availabilityToday', e.target.value)
            }
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
      </section>

      <section className="amate-card amate-actions">
        <button type="button" className="amate-btn-primary" onClick={generateRecommendation}>
          Generate Recommended Trigger Time
        </button>
      </section>

      {lastRecommendation && (
        <section className="amate-card amate-result" aria-live="polite">
          <h2>Your recommendation</h2>
          <dl className="amate-dl">
            <div>
              <dt>Recommended time window</dt>
              <dd>{lastRecommendation.recommendedTimeWindow}</dd>
            </div>
            <div>
              <dt>Micro-action prompt</dt>
              <dd className="amate-prompt">{lastRecommendation.microActionPrompt}</dd>
            </div>
            <div>
              <dt>Safety-aware note</dt>
              <dd>{lastRecommendation.safetyNote}</dd>
            </div>
            <div>
              <dt>Why this time</dt>
              <dd>
                <pre className="amate-explanation">{lastRecommendation.explanation}</pre>
              </dd>
            </div>
            <div>
              <dt>Score snapshot (all windows)</dt>
              <dd className="amate-mono">{formatScores(lastRecommendation.scoreSnapshot)}</dd>
            </div>
          </dl>

          <p className="amate-feedback-label">How did it go?</p>
          <div className="amate-feedback-grid">
            {[
              'Did it',
              'Partially did it',
              'Skip',
              'Later',
              'Too tired',
              'Pain/discomfort',
            ].map((label) => (
              <button
                type="button"
                key={label}
                className="amate-btn-secondary"
                onClick={() => appendFeedback(label)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="amate-card" aria-labelledby="dash-heading">
        <h2 id="dash-heading">Personalization dashboard</h2>
        <div className="amate-dash-grid">
          <div className="amate-stat">
            <h3>Timing scores (from your feedback)</h3>
            <ul className="amate-score-list">
              {TIME_WINDOWS.map((w) => (
                <li key={w}>
                  <span>{w}</span>
                  <span className="amate-mono">{(timingScores[w] ?? 0).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="amate-stat">
            <h3>Best current time window</h3>
            <p className="amate-big">
              {bestWindow}
              <span className="amate-muted amate-mono"> ({bestScore.toFixed(2)})</span>
            </p>
          </div>
          <div className="amate-stat">
            <h3>Feedback events</h3>
            <p className="amate-big">{feedbackHistory.length}</p>
          </div>
          <div className="amate-stat">
            <h3>Safety mode</h3>
            <p className="amate-big">{safetyModeActive ? 'On' : 'Off'}</p>
            <p className="amate-muted amate-small">
              On when pain today is high on the slider, you marked a pain concern in your
              profile, or after &quot;Pain/discomfort&quot; feedback (cleared when you tap
              &quot;Did it&quot; or &quot;Partially did it&quot;, or when you reset demo data).
            </p>
          </div>
        </div>

        <h3 className="amate-history-title">Recent feedback</h3>
        {feedbackHistory.length === 0 ? (
          <p className="amate-muted">No feedback yet.</p>
        ) : (
          <ul className="amate-history">
            {feedbackHistory.slice(0, 8).map((ev, idx) => (
              <li key={`${ev.timestamp}-${idx}`}>
                <span className="amate-mono">{new Date(ev.timestamp).toLocaleString()}</span>
                {' — '}
                <strong>{ev.response}</strong>
                {' @ '}
                {ev.recommendedTimeWindow}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="amate-footer">
        <button type="button" className="amate-btn-danger" onClick={resetDemo}>
          Reset demo data
        </button>
      </footer>
    </div>
  )
}
