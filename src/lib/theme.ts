// Ready Eventos brand + shared design tokens, ported from the prototype.
export const theme = {
  // Brand
  accent: '#D6197E',
  accentDark: '#A81363',
  ink: '#17161A',
  // Surfaces
  bg: '#E8E6E1',
  panel: '#FFFFFF',
  panelSoft: '#FAF9F7',
  field: '#FDFDFC',
  header: '#F7F6F3',
  // Lines
  border: '#E0DED8',
  borderSoft: '#ECEAE5',
  fieldBorder: '#DCD9D2',
  divider: '#F1EFEA',
  // Text
  muted: '#8A867F',
  sub: '#55524D',
  faint: '#B4B0A8',
  // Fonts
  sans: "'Archivo','Helvetica Neue',Helvetica,sans-serif",
  mono: "'JetBrains Mono',monospace",
} as const

// Project-status palette: [foreground, background, border]
export const ESTADOS = [
  'Concepto presentado',
  'Concepto aprobado',
  'Concepto rechazado',
  'Presupuesto',
  'Memoria y planos',
] as const

export type Estado = (typeof ESTADOS)[number]

export const COLORES: Record<string, [string, string, string]> = {
  'Concepto presentado': ['#5A6B8C', '#EEF1F6', '#C9D2E2'],
  'Concepto aprobado': ['#1F8A5B', '#EAF5EF', '#BFDECE'],
  'Concepto rechazado': ['#C03A2B', '#F9ECEA', '#E5C3BD'],
  Presupuesto: ['#B07A1F', '#F7F1E4', '#E2D2AC'],
  'Memoria y planos': ['#D6197E', '#FBEAF3', '#EBBBD4'],
}

// Ready Eventos fixed company data (from CLAUDE.md).
export const READY = {
  empresa: 'Ready Eventos',
  contacto:
    'Calle Soria, 34 · 28864 Ajalvir (Madrid) · +34 677 437 113 · ready@readyeventos.com',
  web: 'readyeventos.com',
}
