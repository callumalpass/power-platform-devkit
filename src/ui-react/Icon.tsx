import type { ReactNode } from 'react';

type IconName = 'bell' | 'sun' | 'moon' | 'power' | 'search' | 'plus' | 'more' | 'star' | 'star-filled' | 'refresh' | 'reply' | 'circle-dashed' | 'grid' | 'pencil' | 'circle';

type Props = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
};

const PATHS: Record<IconName, ReactNode> = {
  bell: (
    <>
      <path d="M6 8a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M6.5 7.5a7 7 0 1 0 11 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  star: <path d="m12 4 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17.3 6.8 20l1-5.8L3.6 10l5.8-.8Z" />,
  'star-filled': <path d="m12 4 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17.3 6.8 20l1-5.8L3.6 10l5.8-.8Z" fill="currentColor" />,
  refresh: (
    <>
      <path d="M4 9a8 8 0 0 1 14-3" />
      <path d="M20 4v5h-5" />
      <path d="M20 15a8 8 0 0 1-14 3" />
      <path d="M4 20v-5h5" />
    </>
  ),
  reply: (
    <>
      <path d="M9 10 4 15l5 5" />
      <path d="M4 15h10a6 6 0 0 0 6-6V5" />
    </>
  ),
  'circle-dashed': <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  pencil: (
    <>
      <path d="m4 20 1-5 11-11 4 4L9 19Z" />
      <path d="m14 6 4 4" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="8" />
};

export function Icon({ name, size = 16, strokeWidth = 1.6, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
