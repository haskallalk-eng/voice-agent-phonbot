import type { ChipySchedule, CalendarStatus, CalendarProvider } from '../../lib/api.js';

export const DEFAULT_SCHEDULE: ChipySchedule = {
  '0': { enabled: false, start: '09:00', end: '17:00' },
  '1': { enabled: true,  start: '09:00', end: '17:00' },
  '2': { enabled: true,  start: '09:00', end: '17:00' },
  '3': { enabled: true,  start: '09:00', end: '17:00' },
  '4': { enabled: true,  start: '09:00', end: '17:00' },
  '5': { enabled: true,  start: '09:00', end: '17:00' },
  '6': { enabled: false, start: '09:00', end: '17:00' },
};

export function getProviderConnection(status: CalendarStatus | null, provider: Exclude<CalendarProvider, 'chipy'>) {
  const fromList = status?.connections?.find((conn) => conn.provider === provider);
  if (fromList) return fromList;
  if (status?.provider === provider) {
    return {
      provider,
      connected: status.connected,
      email: status.email,
      calendarId: status.calendarId ?? null,
      expired: status.expired,
    };
  }
  return null;
}
