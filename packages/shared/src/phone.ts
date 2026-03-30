export function normalizePhoneLight(input: string): { digits: string; normalized: string } {
  const trimmed = input.trim();
  // Keep leading + if present, otherwise just digits.
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  const normalized = hasPlus ? `+${digits}` : digits;
  return { digits, normalized };
}

export function isPlausiblePhone(input: string): boolean {
  const { digits } = normalizePhoneLight(input);
  // Very tolerant MVP: allow short local numbers, but still block obvious spam.
  return digits.length >= 6 && digits.length <= 20;
}
