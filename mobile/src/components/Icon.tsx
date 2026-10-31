import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

/** RideWave's own line icon set: 24-unit grid, 1.8 stroke, rounded joins. */
const P: Record<string, (c: string) => React.ReactNode> = {
  home: c => <Path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5" stroke={c} />,
  rides: c => (
    <>
      <Circle cx="6" cy="16" r="3.5" stroke={c} />
      <Circle cx="18" cy="16" r="3.5" stroke={c} />
      <Path d="M6 16 9.5 9h4l2.5 7M9.5 9H7.5M13.5 9l1.5-3h2.5" stroke={c} />
    </>
  ),
  intercom: c => (
    <>
      <Path d="M5 12a7 7 0 0 1 14 0v4a2 2 0 0 1-2 2h-1v-6h3M5 12v4a2 2 0 0 0 2 2h1v-6H5" stroke={c} />
      <Path d="M12 18v2.5" stroke={c} />
    </>
  ),
  music: c => (
    <>
      <Path d="M9 18V6l11-2v12" stroke={c} />
      <Circle cx="6.5" cy="18" r="2.5" stroke={c} />
      <Circle cx="17.5" cy="16" r="2.5" stroke={c} />
    </>
  ),
  profile: c => (
    <>
      <Circle cx="12" cy="8.5" r="3.5" stroke={c} />
      <Path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" stroke={c} />
    </>
  ),
  fuel: c => (
    <>
      <Rect x="4" y="4" width="10" height="16" rx="1.5" stroke={c} />
      <Path d="M4 10h10M14 8l3.5 2.5V17a1.5 1.5 0 0 0 3 0v-7L18 7" stroke={c} />
    </>
  ),
  food: c => <Path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 21V3c-2.2 1.2-3.2 3.6-3.2 7 0 1.6.7 2.4 3.2 2.4" stroke={c} />,
  cup: c => (
    <>
      <Path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9ZM16 10h1.5a2.5 2.5 0 0 1 0 5H16" stroke={c} />
      <Path d="M8 3.5c0 1 .8 1.3.8 2.3M12 3.5c0 1 .8 1.3.8 2.3" stroke={c} />
    </>
  ),
  restroom: c => (
    <>
      <Circle cx="7.5" cy="5" r="1.8" stroke={c} />
      <Circle cx="16.5" cy="5" r="1.8" stroke={c} />
      <Path d="M5.5 21v-6H4.5V9.5h6V15h-1v6M14 21v-5h-1.5l2-6.5h4l2 6.5H19v5M12 3v18" stroke={c} />
    </>
  ),
  rest: c => <Path d="M3 18h18M5 18v-6h14v6M5 12V8a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v4M15.5 6.5h3l-3 3h3" stroke={c} />,
  wrench: c => <Path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2ZM6 6l2.5 2.5M3.5 3.5 6 6" stroke={c} />,
  sos: c => (
    <>
      <Path d="M12 3 2.5 19.5h19L12 3Z" stroke={c} />
      <Path d="M12 9.5v4.5M12 17v.1" stroke={c} />
    </>
  ),
  plus: c => <Path d="M12 5v14M5 12h14" stroke={c} />,
  qr: c => (
    <>
      <Rect x="4" y="4" width="6" height="6" rx="1" stroke={c} />
      <Rect x="14" y="4" width="6" height="6" rx="1" stroke={c} />
      <Rect x="4" y="14" width="6" height="6" rx="1" stroke={c} />
      <Path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18v2M18 14h2" stroke={c} />
    </>
  ),
  mic: c => (
    <>
      <Rect x="9" y="3" width="6" height="11" rx="3" stroke={c} />
      <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke={c} />
    </>
  ),
  micOff: c => (
    <>
      <Path d="M15 10V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 5 2.2M5.5 11a6.5 6.5 0 0 0 10.6 5M18.5 11c0 .9-.2 1.8-.5 2.6M12 17.5V21M4 4l16 16" stroke={c} />
    </>
  ),
  helmet: c => (
    <>
      <Path d="M3.5 15a8.5 8.5 0 0 1 17 0v2.5H11L9 15H3.5Z" stroke={c} />
      <Path d="M12 6.5c-1 2-1.4 4.4-1 8.5M20.5 13H14" stroke={c} />
    </>
  ),
  map: c => (
    <>
      <Path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z" stroke={c} />
      <Path d="M9 4v14M15 6v14" stroke={c} />
    </>
  ),
  team: c => (
    <>
      <Circle cx="9" cy="8" r="3" stroke={c} />
      <Circle cx="17" cy="9" r="2.4" stroke={c} />
      <Path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M15 14.4c2.6-.4 4.8 1.2 5.5 4.6" stroke={c} />
    </>
  ),
  play: c => <Path d="M7 4.5v15l12-7.5-12-7.5Z" stroke={c} fill={c} />,
  pause: c => <Path d="M7 4.5v15M17 4.5v15" stroke={c} strokeWidth={3.4} />,
  next: c => <Path d="M5 5v14l10-7L5 5ZM19 5v14" stroke={c} />,
  prev: c => <Path d="M19 5v14L9 12l10-7ZM5 5v14" stroke={c} />,
  chevronRight: c => <Path d="m9 5 7 7-7 7" stroke={c} />,
  chevronLeft: c => <Path d="m15 5-7 7 7 7" stroke={c} />,
  close: c => <Path d="M6 6l12 12M18 6 6 18" stroke={c} />,
  check: c => <Path d="m4.5 12.5 5 5 10-11" stroke={c} />,
  signal: c => <Path d="M4 19v-2M9 19v-5M14 19v-8M19 19V6" stroke={c} strokeWidth={2.4} />,
  wifiOff: c => <Path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.3-2.6M19 13a10 10 0 0 0-2-1.6M2 9.5a15 15 0 0 1 3.4-2.3M12 20h.01" stroke={c} />,
  nearby: c => (
    <>
      <Circle cx="12" cy="12" r="2" stroke={c} />
      <Path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" stroke={c} />
    </>
  ),
  pin: c => (
    <>
      <Path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" stroke={c} />
      <Circle cx="12" cy="10" r="2.3" stroke={c} />
    </>
  ),
  flag: c => <Path d="M5 21V4M5 4h11l-2 4 2 4H5" stroke={c} />,
  speaker: c => <Path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5ZM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" stroke={c} />,
  bell: c => <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2.2 2.2 0 0 0 4 0" stroke={c} />,
  settings: c => (
    <>
      <Circle cx="12" cy="12" r="3" stroke={c} />
      <Path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" stroke={c} />
    </>
  ),
  moon: c => <Path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" stroke={c} />,
  phone: c => <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" stroke={c} />,
  share: c => (
    <>
      <Circle cx="6" cy="12" r="2.5" stroke={c} />
      <Circle cx="18" cy="6" r="2.5" stroke={c} />
      <Circle cx="18" cy="18" r="2.5" stroke={c} />
      <Path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" stroke={c} />
    </>
  ),
  edit: c => <Path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" stroke={c} />,
  logout: c => <Path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" stroke={c} />,
  crash: c => <Path d="m4 20 5-5M12 3l1.5 4.5L18 6l-2 4 4 2-4.5 1.5L17 18l-4-2-1 4-2-3.5L6 18l1-4-4-1 4-2.5L5 7l4.5 1.5L12 3Z" stroke={c} />,
  hand: c => <Path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6.5M14 10V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3 15.5a1.6 1.6 0 0 1 2.6-1.8L8 16" stroke={c} />,
  battery: c => (
    <>
      <Rect x="3" y="7" width="16" height="10" rx="2" stroke={c} />
      <Path d="M21 10.5v3" stroke={c} />
    </>
  ),
  dots: c => <Path d="M5 12h.01M12 12h.01M19 12h.01" stroke={c} strokeWidth={3.2} />,
  route: c => (
    <>
      <Circle cx="6" cy="18" r="2.2" stroke={c} />
      <Circle cx="18" cy="6" r="2.2" stroke={c} />
      <Path d="M8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16" stroke={c} />
    </>
  ),
  clock: c => (
    <>
      <Circle cx="12" cy="12" r="8.5" stroke={c} />
      <Path d="M12 7.5V12l3 2" stroke={c} />
    </>
  ),
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 24, color, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const { c } = useTheme();
  const col = color ?? c.text;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {P[name](col)}
    </Svg>
  );
}
