/**
 * Pedalshield design tokens. Dark by default - cycling at dawn aesthetic
 * with a strong magenta accent (Zcash-adjacent).
 */
export const theme = {
  color: {
    bg: '#0A0E1A',
    bgElev: '#141A2A',
    bgCard: '#1A2238',
    text: '#E6EBFF',
    textDim: '#8993B5',
    textMuted: '#5A6485',
    accent: '#D946EF',
    accentSoft: '#A855F7',
    success: '#22D3A1',
    warning: '#FBBF24',
    danger: '#F87171',
    border: '#252D44',
    overlay: 'rgba(10, 14, 26, 0.85)',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 8, md: 16, lg: 24, pill: 999 },
  font: {
    display: { size: 48, weight: '800' as const, letterSpacing: -1.5 },
    h1: { size: 32, weight: '700' as const, letterSpacing: -0.5 },
    h2: { size: 22, weight: '700' as const },
    body: { size: 16, weight: '400' as const },
    label: { size: 13, weight: '600' as const, letterSpacing: 0.6 },
    mono: { size: 13, weight: '500' as const },
  },
} as const;

export type Theme = typeof theme;
