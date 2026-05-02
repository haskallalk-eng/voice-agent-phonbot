import React from 'react';

type IconProps = { size?: number; className?: string };

const icon =
  (content: (s: number) => React.ReactNode) =>
  ({ size = 24, className = '' }: IconProps): React.ReactElement =>
    (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {content(size)}
      </svg>
    );

/** House with door */
export const IconHome = icon(() => (
  <>
    <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1v-9.5z" />
    <path d="M9 21V12h6v9" />
  </>
));

/** Microphone with soundwaves */
export const IconAgent = icon(() => (
  <>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0014 0" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <path d="M2 10c0 0 1-1 2 0" strokeWidth={1.5} />
    <path d="M20 10c0 0 1-1 2 0" strokeWidth={1.5} />
  </>
));

/** Speech bubble with waveform inside */
export const IconTest = icon(() => (
  <>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
    <path d="M8 10h0M10 8v4M12 9v2M14 7v6M16 10h0" strokeWidth={1.5} />
  </>
));

/** Inbox tray with horizontal line */
export const IconTickets = icon(() => (
  <>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
  </>
));

/** Bar chart – 3 vertical bars */
export const IconCalls = icon(() => (
  <>
    <rect x="4" y="14" width="4" height="7" rx="1" />
    <rect x="10" y="9" width="4" height="12" rx="1" />
    <rect x="16" y="5" width="4" height="16" rx="1" />
  </>
));

/** Classic telephone handset */
export const IconPhone = icon(() => (
  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
));

/** Calendar with 2 content lines */
export const IconCalendar = icon(() => (
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="14" x2="16" y2="14" />
    <line x1="8" y1="18" x2="13" y2="18" />
  </>
));

/** Credit card with stripe */
export const IconBilling = icon(() => (
  <>
    <rect x="1" y="4" width="22" height="16" rx="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
    <line x1="5" y1="15" x2="9" y2="15" strokeWidth={2} />
  </>
));

/** Rectangle with arrow out (logout) */
export const IconLogout = icon(() => (
  <>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>
));

/** Rocket launching diagonally */
export const IconDeploy = icon(() => (
  <>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </>
));

/** Gear / settings */
export const IconSettings = icon(() => (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </>
));

/** Microphone with upload arrow */
export const IconMicUpload = icon(() => (
  <>
    <rect x="9" y="3" width="6" height="10" rx="3" />
    <path d="M5 11a7 7 0 0014 0" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="8" y1="22" x2="16" y2="22" />
    <polyline points="9 7 12 4 15 7" />
  </>
));

/** Play triangle inside circle */
export const IconPlay = icon(() => (
  <>
    <circle cx="12" cy="12" r="10" />
    <polygon points="10 8 16 12 10 16 10 8" />
  </>
));

/** Stacked books with a subtle bookmark */
export const IconKnowledge = icon(() => (
  <>
    <path d="M7 5.5h10.5a1.75 1.75 0 010 3.5H7a1.75 1.75 0 010-3.5z" />
    <path d="M5.5 10.25h12a1.75 1.75 0 010 3.5h-12a1.75 1.75 0 010-3.5z" />
    <path d="M6.5 15h12a1.75 1.75 0 010 3.5h-12a1.75 1.75 0 010-3.5z" />
    <path d="M8 9h8.75M6.75 13.75H16M7.75 18.5h9.75" strokeWidth={1.2} />
    <path d="M15.25 5.5V9l1.05-.72L17.35 9V5.5" strokeWidth={1.25} />
  </>
));

/** Lightning bolt */
export const IconCapabilities = icon(() => (
  <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
));

/** Padlock */
export const IconPrivacy = icon(() => (
  <>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
    <circle cx="12" cy="16" r="1" fill="currentColor" />
  </>
));

/** Two circles connected by a line (webhook) */
export const IconWebhook = icon(() => (
  <>
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="12" r="3" />
    <line x1="9" y1="12" x2="15" y2="12" />
    <path d="M6 9V6" />
    <path d="M18 15v3" />
  </>
));

/** Simple chevron down */
export const IconChevronDown = icon(() => (
  <polyline points="6 9 12 15 18 9" />
));

/** Scissors */
export const IconScissors = icon(() => (
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </>
));

/** Wrench */
export const IconWrench = icon(() => (
  <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
));

/** Medical cross */
export const IconMedical = icon(() => (
  <>
    <rect x="9" y="2" width="6" height="20" rx="2" />
    <rect x="2" y="9" width="20" height="6" rx="2" />
  </>
));

/** Broom */
export const IconBroom = icon(() => (
  <>
    <path d="M3 21l7-7" />
    <path d="M13.5 5.5l5.19-1.04 1.04 5.2-9.23 9.23a2 2 0 01-2.83 0l-2.83-2.83a2 2 0 010-2.83z" />
    <path d="M7.4 13.4l4.24-4.24" />
  </>
));

/** Fork and knife / Restaurant */
export const IconRestaurant = icon(() => (
  <>
    <line x1="18" y1="2" x2="18" y2="22" />
    <path d="M22 8H14V2" />
    <line x1="6" y1="2" x2="6" y2="8" />
    <path d="M2 8a4 4 0 008 0" />
    <line x1="6" y1="12" x2="6" y2="22" />
  </>
));

/** Star / Sparkle for success states */
export const IconStar = icon(() => (
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
));

/** Headphones */
export const IconHeadphones = icon(() => (
  <>
    <path d="M3 18v-6a9 9 0 0118 0v6" />
    <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z" />
  </>
));

/** Car / Autowerkstatt */
export function IconCar({ size = 24, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true">
      <path d="M5 17H3a2 2 0 01-2-2v-4l2.69-6.73A2 2 0 015.54 3h12.92a2 2 0 011.85 1.27L23 11v4a2 2 0 01-2 2h-2" />
      <circle cx="7.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="17.5" r="2.5" />
    </svg>
  );
}

/** Lightning bolt */
export function IconBolt({ size = 24, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

/** Brain / AI Insights */
export const IconInsights = icon(() => (
  <>
    <path d="M9.5 2a2.5 2.5 0 015 0v1a7 7 0 010 14v1a2.5 2.5 0 01-5 0v-1a7 7 0 010-14V2z" />
    <path d="M12 6v6M9 9h6" strokeWidth={1.5} />
  </>
));

/** Target / Outbound Sales */
export const IconOutbound = icon(() => (
  <>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
    <line x1="22" y1="2" x2="16" y2="8" />
    <polyline points="19 2 22 2 22 5" />
  </>
));

/** Phone with plus sign */
export const IconPhonePlus = icon(() => (
  <>
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    <line x1="19" y1="1" x2="19" y2="7" />
    <line x1="16" y1="4" x2="22" y2="4" />
  </>
));

/** Phone with forward arrow */
export const IconPhoneForward = icon(() => (
  <>
    <polyline points="19 1 23 5 19 9" />
    <line x1="15" y1="5" x2="23" y2="5" />
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
  </>
));

/** Eye — used in PasswordInput to show plain-text */
export const IconEye = icon(() => (
  <>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </>
));

/** Eye-off — used in PasswordInput to hide plain-text */
export const IconEyeOff = icon(() => (
  <>
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </>
));

/** Brain – knowledge/AI */
export const IconBrain = icon(() => (
  <>
    <path d="M9.5 2a2.5 2.5 0 00-2.45 2H7a5 5 0 00-5 5c0 1.4.58 2.67 1.5 3.58A4 4 0 005 15a4 4 0 003.5 3.96V20a2 2 0 004 0v-1.04A4 4 0 0016 15a4 4 0 00.5-7.42A5 5 0 0012 4.07V4a2.5 2.5 0 00-2.5-2z" />
    <path d="M12 6v6M9.5 9.5l5 0" strokeWidth={1.5} />
  </>
));

/** Building / office / business */
export const IconBuilding = icon(() => (
  <>
    <rect x="4" y="2" width="16" height="20" rx="1" />
    <path d="M9 22V12h6v10" />
    <rect x="8" y="6" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
    <rect x="14" y="6" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
    <rect x="8" y="10" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
    <rect x="14" y="10" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
  </>
));

/** Volume / speaker */
export const IconVolume = icon(() => (
  <>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 010 14.14" />
    <path d="M15.54 8.46a5 5 0 010 7.07" />
  </>
));

/** Sliders horizontal */
export const IconSliders = icon(() => (
  <>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="8" cy="6" r="2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="10" cy="18" r="2" fill="currentColor" stroke="none" />
  </>
));

/** Open book */
export const IconBookOpen = icon(() => (
  <>
    <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
    <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
  </>
));

/** Message square / chat bubble */
export const IconMessageSquare = icon(() => (
  <>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </>
));

/** Layout / template grid */
export const IconTemplate = icon(() => (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </>
));

/** Globe / web */
export const IconGlobe = icon(() => (
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
  </>
));

/** File text / document */
export const IconFileText = icon(() => (
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </>
));

/** X / close / remove */
export const IconX = icon(() => (
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>
));

/** Check circle / success */
export const IconCheckCircle = icon(() => (
  <>
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </>
));

/** Plug / API integration */
export const IconPlug = icon(() => (
  <>
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 01-4 4h-4a4 4 0 01-4-4V8z" />
  </>
));

/** Alert triangle / warning */
export const IconAlertTriangle = icon(() => (
  <>
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth={2.5} />
  </>
));

/** Info circle */
export const IconInfo = icon(() => (
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" strokeWidth={2.5} />
  </>
));

/** Mic (simple) */
export const IconMic = icon(() => (
  <>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0014 0" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <line x1="8" y1="21" x2="16" y2="21" />
  </>
));

/** Person / user */
export const IconUser = icon(() => (
  <>
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
));

/** Chevron right */
export const IconChevronRight = icon(() => (
  <polyline points="9 18 15 12 9 6" />
));

/** Phone outgoing (transfer/forward) */
export const IconPhoneOut = icon(() => (
  <>
    <polyline points="23 7 23 1 17 1" />
    <line x1="16" y1="8" x2="23" y2="1" />
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
  </>
));

/** Phone off / hang up */
export const IconPhoneOff = icon(() => (
  <>
    <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-2.6-3.41" />
    <path d="M6.24 6.24A19.79 19.79 0 002.07 14.9a2 2 0 002 2.11h.09A16.84 16.84 0 006.97 16" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </>
));

/** Ticket / note */
export const IconTicket = icon(() => (
  <>
    <path d="M2 9a3 3 0 010-6h20a3 3 0 010 6" />
    <path d="M2 15a3 3 0 000 6h20a3 3 0 000-6" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="12" y1="6" x2="12" y2="6.01" strokeWidth={2} />
    <line x1="12" y1="15" x2="12" y2="15.01" strokeWidth={2} />
  </>
));

/** Refresh — two circular arrows */
export function IconRefresh({ size = 24, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  );
}
