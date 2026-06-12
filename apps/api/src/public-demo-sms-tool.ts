import crypto from 'node:crypto';

export const PUBLIC_DEMO_SMS_TOOL_NAME = 'demo_send_test_sms';
export const PUBLIC_DEMO_SMS_TOOL_PATH = '/retell/tools/demo_send_test_sms';
export const PUBLIC_DEMO_TEST_LINK = 'https://phonbot.de/demo';

function publicDemoToolAuthSecret(): string {
  const secret = process.env.RETELL_TOOL_AUTH_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RETELL_TOOL_AUTH_SECRET (or JWT_SECRET) required in production for public demo SMS tool auth');
    }
    return 'dev-retell-tool-auth';
  }
  return secret;
}

export function publicDemoSmsToolSignature(): string {
  return crypto.createHmac('sha256', publicDemoToolAuthSecret()).update('public-demo-send-test-sms:v1').digest('base64url');
}

function compact(value: unknown, max = 80): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

export type PublicDemoSmsKind = 'appointment_confirmation' | 'test_link' | 'callback_link';

export function buildPublicDemoSimulatedSmsBody(input: {
  smsKind?: unknown;
  customerName?: unknown;
  service?: unknown;
  date?: unknown;
  time?: unknown;
}): string {
  const kind = compact(input.smsKind, 40) as PublicDemoSmsKind | '';
  const service = compact(input.service, 50);
  const date = compact(input.date, 40);
  const time = compact(input.time, 40);
  const name = compact(input.customerName, 40);
  const greeting = name ? `Hallo ${name}, ` : '';
  const appointmentParts = [service, date, time].filter(Boolean).join(', ');

  if (kind === 'appointment_confirmation' || appointmentParts) {
    const details = appointmentParts || 'dein Terminwunsch';
    return `${greeting}PhoneBot Demo: Ihr simulierter Termin ${details} wurde aufgenommen (simuliert). Wenn Sie PhoneBot testen moechten: ${PUBLIC_DEMO_TEST_LINK}`;
  }

  if (kind === 'callback_link') {
    return `${greeting}PhoneBot Demo: Dein Rueckrufwunsch wurde simuliert notiert. Testlink: ${PUBLIC_DEMO_TEST_LINK}`;
  }

  return `${greeting}PhoneBot Demo: Hier ist dein Testlink: ${PUBLIC_DEMO_TEST_LINK}`;
}
