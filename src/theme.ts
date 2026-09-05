/**
 * Monochrome palette. Everything is a shade of one neutral; hierarchy comes
 * from contrast and weight, not hue. Semantic tokens are kept so call sites
 * stay readable, but they resolve to greys as well.
 */
export const colors = {
  background: '#0B0B0C',
  surface: '#141416',
  surfaceRaised: '#1C1C1F',
  border: '#26262A',
  text: '#F4F4F5',
  muted: '#9A9AA1',
  faint: '#5F5F66',
  primary: '#F4F4F5',
  primarySoft: '#1C1C1F',
  accent: '#F4F4F5',
  success: '#D4D4D8',
  successSoft: '#1C1C1F',
  warning: '#A1A1AA',
  warningSoft: '#1C1C1F',
  danger: '#A1A1AA',
  dangerSoft: '#1C1C1F',
  star: '#F4F4F5',
  onPrimary: '#0B0B0C',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 4, md: 6, lg: 8, xl: 10, pill: 999 };
