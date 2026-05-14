/**
 * 30-minute time slots from 07:00 to 21:30 (local conceptual clock for the demo).
 */

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toLabel(hour, minute) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const ampm = hour < 12 ? 'AM' : 'PM'
  return `${h12}:${pad2(minute)} ${ampm}`
}

const slots = []
for (let h = 7; h <= 21; h++) {
  for (const m of [0, 30]) {
    slots.push({
      id: `${pad2(h)}:${pad2(m)}`,
      label: toLabel(h, m),
      hour: h,
      minute: m,
    })
  }
}

export const TIME_SLOTS = slots

export const TIME_SLOT_IDS = TIME_SLOTS.map((s) => s.id)

/** Minutes from midnight for sorting / proximity */
export function slotMinutes(slot) {
  return slot.hour * 60 + slot.minute
}

export function getSlotById(id) {
  return TIME_SLOTS.find((s) => s.id === id) ?? null
}

/**
 * Map a 30-minute slot into named day parts for preferences / scoring.
 * @param {{ hour: number, minute: number }} slot
 * @param {'morning'|'afternoon'|'evening'|'after_dinner'} rangeId
 */
export function slotMatchesNamedRange(slot, rangeId) {
  if (!slot || !rangeId) return false
  const m = slotMinutes(slot)
  switch (rangeId) {
    case 'morning':
      return m >= 7 * 60 && m <= 11 * 60 + 30
    case 'afternoon':
      return m >= 12 * 60 && m <= 15 * 60 + 30
    case 'evening':
      return m >= 16 * 60 && m < 19 * 60 + 30
    case 'after_dinner':
      return m >= 19 * 60 + 30 && m <= 21 * 60 + 30
    default:
      return false
  }
}
