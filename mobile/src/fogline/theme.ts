/**
 * Fogline palette. Deliberately NOT Pedalshield's magenta-on-navy: if a
 * screenshot could be mistaken for Pedalshield or Strava, the UI is wrong.
 * Near-black field, cold fog, a single teal "cleared" light, and gold for
 * the public quest.
 */
export const fog = {
  bg: '#05070B',
  panel: '#0B0F16',
  line: '#161D29',
  fogFill: '#0C1119',
  fogEdge: '#141B26',
  clear: '#5EEAD4',
  clearFill: 'rgba(94, 234, 212, 0.16)',
  bloomFill: 'rgba(94, 234, 212, 0.42)',
  quest: '#F5C451',
  questFill: 'rgba(245, 196, 81, 0.10)',
  questClearFill: 'rgba(245, 196, 81, 0.38)',
  text: '#D7DEE8',
  dim: '#6B778A',
  muted: '#3E4757',
  danger: '#F87171',
} as const;

export const mono = 'Menlo';
