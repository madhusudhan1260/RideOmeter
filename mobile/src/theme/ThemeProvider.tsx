import React, { createContext, useContext, useMemo } from 'react';
import { useSettings } from '../store/settings';
import { dayPalette, nightPalette, Palette } from './tokens';

type Theme = { c: Palette; night: boolean };

const ThemeContext = createContext<Theme>({ c: dayPalette, night: false });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const night = useSettings(s => s.nightMode);
  const value = useMemo(() => ({ c: night ? nightPalette : dayPalette, night }), [night]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
