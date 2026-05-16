/**
 * Pre-written push notification templates by tone.
 * Placeholders: {{time}}, {{action}}, {{duration}}
 */

export const TONES = [
  'gentle',
  'informational',
  'structured',
  'motivational',
  'risk_framed',
]

export const promptTemplatesByTone = {
  gentle: [
    'Around {{time}}, if it feels okay, try {{action}} for about {{duration}}. Small steps count.',
    'When {{time}} comes, you might like a soft reset: {{action}} for roughly {{duration}}, at your own pace.',
    'A gentle nudge for {{time}}: {{action}} for about {{duration}}—only if it fits your energy today.',
  ],
  informational: [
    'Scheduled nudge ({{time}}): {{action}} for approximately {{duration}} supports light movement breaks.',
    'At {{time}}, a brief {{duration}} bout of {{action}} can break up long sitting without a big time cost.',
    'Reminder: {{time}} is a practical slot for {{action}} (~{{duration}}) based on your preferences.',
  ],
  structured: [
    '{{time}} — Step 1: stand safely. Step 2: {{action}} for {{duration}}. Step 3: return to what you were doing.',
    'Micro-session plan: {{time}} · {{action}} · timer target {{duration}} · stop if uncomfortable.',
    'At {{time}}, follow this sequence: prepare space → {{action}} ({{duration}}) → brief check-in with yourself.',
  ],
  motivational: [
    '{{time}} is your window—{{action}} for {{duration}} can help you keep momentum today.',
    'You set this direction: at {{time}}, take {{duration}} for {{action}} and mark a win.',
    'Quick boost at {{time}}: {{action}} for {{duration}}—enough to feel progress, not enough to overwhelm.',
  ],
  risk_framed: [
    'Long stretches without movement can add strain. At {{time}}, consider {{action}} for {{duration}}.',
    'Sitting-heavy days add load over time. A {{duration}} {{action}} break at {{time}} can reduce that buildup.',
    'If you have been still for a while, {{time}} is a good checkpoint: {{action}} for about {{duration}}.',
  ],
}

const ACTION_COPY = {
  indoor_walk: {
    soft: 'take a light indoor walk',
    noun: 'indoor walk',
    reset: 'light indoor walk',
  },
  standing_movement: {
    soft: 'stand up and move lightly',
    noun: 'standing reset',
    reset: 'posture reset',
  },
  gentle_stretching: {
    soft: 'try a short stretch',
    noun: 'short stretch',
    reset: 'short stretch',
  },
  after_meal_walk: {
    soft: 'take a short walk after eating',
    noun: 'walk after eating',
    reset: 'after-meal walk',
  },
  ankle_movement: {
    soft: 'do a small ankle movement reset',
    noun: 'ankle movement reset',
    reset: 'small movement reset',
  },
}

function durationPhrase(duration) {
  if (duration === '<1') return 'under a minute'
  if (duration === '1–2') return '1–2 minutes'
  if (duration === '3–5') return '3–5 minutes'
  if (duration === '5–10') return '5–10 minutes'
  if (duration === '10+') return '10 minutes'
  if (duration <= 1) return 'under a minute'
  if (duration <= 1.5) return '1–2 minutes'
  if (duration <= 4) return '3–5 minutes'
  if (duration <= 7.5) return '5–10 minutes'
  return '10 minutes'
}

/**
 * User-facing push preview. Uses only fixed, safe copy variants.
 * @param {string} tone
 * @param {string} actionId
 * @param {string | number} duration
 */
export function composePromptMessage(tone, actionId, duration) {
  const action = ACTION_COPY[actionId] ?? ACTION_COPY.standing_movement
  const d = durationPhrase(duration)
  if (tone === 'informational') {
    if (actionId === 'after_meal_walk') {
      return `A short walk after eating can support your routine. Try ${d}.`
    }
    return `A brief ${action.noun} can support your routine. Try ${d}.`
  }
  if (tone === 'structured') {
    if (actionId === 'standing_movement') {
      return `Stand up, reset your posture, and move lightly for ${d}.`
    }
    return `Start simple: ${action.soft} for ${d}. Then return to your day.`
  }
  if (tone === 'motivational') {
    return `Build momentum with a ${action.reset}. Aim for ${d}.`
  }
  if (tone === 'risk_framed') {
    return `Break up long sitting with a ${action.reset}. Start with ${d}.`
  }
  return `${action.soft.charAt(0).toUpperCase()}${action.soft.slice(1)} for ${d}. Keep it easy.`
}

/**
 * @param {string} tone
 * @param {{ time: string, action: string, duration: string }} vars
 */
export function renderPromptTemplate(tone, vars) {
  const list = promptTemplatesByTone[tone] ?? promptTemplatesByTone.gentle
  let h = 0
  for (let i = 0; i < tone.length; i++) h = (h + tone.charCodeAt(i)) % 997
  let text = list[h % list.length]
  text = text.replace(/\{\{time\}\}/g, vars.time)
  text = text.replace(/\{\{action\}\}/g, vars.action)
  text = text.replace(/\{\{duration\}\}/g, vars.duration)
  return text
}
