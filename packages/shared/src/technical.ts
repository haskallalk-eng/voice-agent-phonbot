export type InterruptionMode = 'allow' | 'hold' | 'block';

export type TechnicalConfigInput = {
  speakingSpeed?: number | null;
  temperature?: number | null;
  maxCallDuration?: number | null; // seconds
  interruptionMode?: InterruptionMode | null;
  interruptionSensitivity?: number | null;
  responsiveness?: number | null;
  enableBackchannel?: boolean | null;
  enableDtmf?: boolean | null;
};

export type TechnicalModePreset = {
  mode: InterruptionMode;
  label: string;
  description: string;
  interruptionSensitivity: number;
  responsiveness: number;
  enableBackchannel: boolean;
};

export type DerivedTechnicalRuntime = {
  voiceSpeed: number;
  modelTemperature: number;
  maxCallDurationSeconds: number;
  maxCallDurationMs: number;
  interruptionMode: InterruptionMode;
  interruptionModeLabel: string;
  interruptionSensitivity: number;
  responsiveness: number;
  enableBackchannel: boolean;
  allowUserDtmf: boolean;
};

export const DEFAULT_MODEL_TEMPERATURE = 0.3;

export const TECHNICAL_MODE_PRESETS: Record<InterruptionMode, TechnicalModePreset> = {
  allow: {
    mode: 'allow',
    label: 'Natuerlich',
    description: 'Laesst klare Stopps zu, bleibt aber ruhiger bei Hintergrundgeraeuschen.',
    interruptionSensitivity: 0.75,
    responsiveness: 0.8,
    enableBackchannel: false,
  },
  hold: {
    mode: 'hold',
    label: 'Kurz halten',
    description: 'Etwas ruhiger, beendet Saetze haeufiger erst sauber.',
    interruptionSensitivity: 0.45,
    responsiveness: 1,
    enableBackchannel: true,
  },
  block: {
    mode: 'block',
    label: 'Ruhig',
    description: 'Spricht kontrollierter, bleibt aber fuer Stopp- und Nein-Signale unterbrechbar.',
    interruptionSensitivity: 0.35,
    responsiveness: 1,
    enableBackchannel: false,
  },
};

const MIN_VOICE_SPEED = 0.5;
const MAX_VOICE_SPEED = 2.0;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 1;
const MIN_CALL_DURATION_SECONDS = 60;
const MAX_CALL_DURATION_SECONDS = 14_400;
const MIN_TUNING = 0;
const MAX_TUNING = 1;
const MIN_INTERRUPTIBLE_SENSITIVITY = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickNumber(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function deriveTechnicalRuntimeSettings(input: TechnicalConfigInput): DerivedTechnicalRuntime {
  const mode = input.interruptionMode ?? 'allow';
  const preset = TECHNICAL_MODE_PRESETS[mode];
  const voiceSpeed = clamp(pickNumber(input.speakingSpeed, 1), MIN_VOICE_SPEED, MAX_VOICE_SPEED);
  const modelTemperature = clamp(pickNumber(input.temperature, DEFAULT_MODEL_TEMPERATURE), MIN_TEMPERATURE, MAX_TEMPERATURE);
  const maxCallDurationSeconds = Math.round(
    clamp(
      pickNumber(input.maxCallDuration, 300),
      MIN_CALL_DURATION_SECONDS,
      MAX_CALL_DURATION_SECONDS,
    ),
  );
  const interruptionSensitivity = clamp(
    pickNumber(input.interruptionSensitivity, preset.interruptionSensitivity),
    MIN_INTERRUPTIBLE_SENSITIVITY,
    MAX_TUNING,
  );
  const responsiveness = clamp(
    pickNumber(input.responsiveness, preset.responsiveness),
    MIN_TUNING,
    MAX_TUNING,
  );
  const enableBackchannel = input.enableBackchannel ?? preset.enableBackchannel;

  return {
    voiceSpeed,
    modelTemperature,
    maxCallDurationSeconds,
    maxCallDurationMs: maxCallDurationSeconds * 1000,
    interruptionMode: mode,
    interruptionModeLabel: preset.label,
    interruptionSensitivity,
    responsiveness,
    enableBackchannel,
    allowUserDtmf: input.enableDtmf ?? false,
  };
}

export function formatCallDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')} Min`;
}
