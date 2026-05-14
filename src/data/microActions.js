export const MICRO_ACTIONS = [
  {
    id: 'indoor_walk',
    label: 'Indoor walk',
    defaultDuration: 2,
    intensity: 'low',
    suitableForPain: true,
    suitableForFatigue: true,
    goodForWeatherBad: true,
    description: 'Easy steps indoors, enough space to move safely.',
  },
  {
    id: 'standing_movement',
    label: 'Standing movement',
    defaultDuration: 2,
    intensity: 'low',
    suitableForPain: true,
    suitableForFatigue: true,
    goodForWeatherBad: true,
    description: 'Light shifts, weight changes, and easy reaches while standing.',
  },
  {
    id: 'gentle_stretching',
    label: 'Gentle stretching',
    defaultDuration: 3,
    intensity: 'low',
    suitableForPain: false,
    suitableForFatigue: true,
    goodForWeatherBad: true,
    description: 'Slow range-of-motion moves; avoid deep or aggressive stretching.',
  },
  {
    id: 'after_meal_walk',
    label: 'After-meal walk',
    defaultDuration: 5,
    intensity: 'low',
    suitableForPain: true,
    suitableForFatigue: false,
    goodForWeatherBad: false,
    description: 'A short easy walk, often best when weather and energy allow.',
  },
  {
    id: 'ankle_movement',
    label: 'Ankle movement',
    defaultDuration: 1,
    intensity: 'very_low',
    suitableForPain: true,
    suitableForFatigue: true,
    goodForWeatherBad: true,
    description: 'Seated ankle pumps and circles—minimal load, easy to stop.',
  },
]

export const MICRO_ACTION_IDS = MICRO_ACTIONS.map((a) => a.id)

export function getMicroActionById(id) {
  return MICRO_ACTIONS.find((a) => a.id === id) ?? null
}
