/**
 * RideWave "Instrument Cluster" design tokens.
 * Matte surfaces, hairline bezels, one amber accent, red reserved for danger.
 */

export type Palette = {
  bg: string;
  surface: string;
  surfaceRaised: string;
  bezel: string;
  bezelStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  live: string;
  warn: string;
  danger: string;
  dangerSoft: string;
  info: string;
  overlay: string;
};

export const dayPalette: Palette = {
  bg: '#0B0C0E',
  surface: '#141518',
  surfaceRaised: '#1B1D21',
  bezel: '#24262B',
  bezelStrong: '#34373D',
  text: '#F5F5F2',
  textDim: '#A3A6AD',
  textFaint: '#6B6F77',
  accent: '#FF8A00',
  accentSoft: 'rgba(255,138,0,0.14)',
  accentInk: '#140A00',
  live: '#30D158',
  warn: '#FFC233',
  danger: '#FF3B30',
  dangerSoft: 'rgba(255,59,48,0.16)',
  info: '#5AC8FA',
  overlay: 'rgba(0,0,0,0.72)',
};

/** High-contrast night mode: pure black, brighter borders and secondary text. */
export const nightPalette: Palette = {
  bg: '#000000',
  surface: '#0A0A0A',
  surfaceRaised: '#121212',
  bezel: '#3A3A3A',
  bezelStrong: '#5A5A5A',
  text: '#FFFFFF',
  textDim: '#D0D0D0',
  textFaint: '#A0A0A0',
  accent: '#FFC24D',
  accentSoft: 'rgba(255,194,77,0.18)',
  accentInk: '#000000',
  live: '#4CFF7A',
  warn: '#FFE066',
  danger: '#FF5A4F',
  dangerSoft: 'rgba(255,90,79,0.22)',
  info: '#8AD8FF',
  overlay: 'rgba(0,0,0,0.85)',
};

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 } as const;

/** Glove-friendly targets. */
export const touch = { min: 48, ride: 64, hero: 200 } as const;

/**
 * Display = condensed gauge face (Rajdhani), body = Inter.
 * Run `npm run fonts` to fetch the OFL font files; until linked the OS default is used.
 */
export const fonts = {
  display: 'Rajdhani-Bold',
  displayMedium: 'Rajdhani-SemiBold',
  body: 'Inter-Regular',
  bodyMedium: 'Inter-Medium',
  bodyBold: 'Inter-SemiBold',
} as const;

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 44, lineHeight: 46, letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, letterSpacing: 0.4 },
  heading: { fontFamily: fonts.displayMedium, fontSize: 22, lineHeight: 26, letterSpacing: 0.3 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19 },
  /** Caps label with tracking, the "cluster legend" style. */
  label: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16, letterSpacing: 1.6 },
  numeral: { fontFamily: fonts.display, fontSize: 36, lineHeight: 38, fontVariant: ['tabular-nums'] as const },
} as const;

export type TypeVariant = keyof typeof type;
