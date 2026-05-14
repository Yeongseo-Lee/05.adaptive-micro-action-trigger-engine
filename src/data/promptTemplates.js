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
