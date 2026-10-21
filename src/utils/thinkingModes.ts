import { SoulTuningConfig } from '../types/index.ts';

export type ThinkingPresetId = 'neutral' | 'executive' | 'red_team' | 'visionary';

export interface ThinkingPresetColors {
  bg: string;
  text: string;
  border: string;
  dot: string;
}

export interface ThinkingPreset {
  id: ThinkingPresetId;
  label: string;
  shortLabel: string;
  icon: string;
  tagline: string;
  description: string;
  effect: string;
  weights: SoulTuningConfig;
  colors: ThinkingPresetColors;
}

export const THINKING_PRESETS: readonly ThinkingPreset[] = [
  {
    id: 'neutral',
    label: 'Neutral Thought Partner',
    shortLabel: 'Neutral',
    icon: '⚖️',
    tagline: 'Balanced baseline',
    description: 'Equilibrium between rigorous analysis and thoughtful conversational warmth.',
    effect: 'Delivers measured, thoughtful responses balancing objective analysis with conversational warmth.',
    weights: { tone: 50, directness: 50, perspective: 50 },
    colors: {
      bg: 'bg-emerald-500/10 dark:bg-emerald-500/15',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-500/30',
      dot: 'bg-emerald-500',
    },
  },
  {
    id: 'executive',
    label: 'Executive Briefing',
    shortLabel: 'Executive',
    icon: '🎯',
    tagline: 'Ultra-concise takeaways',
    description: 'Bottom-line conclusions, bulleted points, and high-signal recommendations.',
    effect: 'Compresses answers into bottom-line bullet points with zero preamble and high signal-to-noise ratio.',
    weights: { tone: 20, directness: 15, perspective: 50 },
    colors: {
      bg: 'bg-sky-500/10 dark:bg-sky-500/15',
      text: 'text-sky-700 dark:text-sky-300',
      border: 'border-sky-500/30',
      dot: 'bg-sky-500',
    },
  },
  {
    id: 'red_team',
    label: "Red Team / Devil's Advocate",
    shortLabel: 'Red Team',
    icon: '🛡️',
    tagline: 'Aggressive assumption stress-testing',
    description: 'Actively probes vulnerabilities, failure modes, and unaddressed risks.',
    effect: 'Rigorously stress-tests your reasoning, challenging unstated assumptions and highlighting downside risks.',
    weights: { tone: 15, directness: 25, perspective: 10 },
    colors: {
      bg: 'bg-rose-500/10 dark:bg-rose-500/15',
      text: 'text-rose-700 dark:text-rose-300',
      border: 'border-rose-500/30',
      dot: 'bg-rose-500',
    },
  },
  {
    id: 'visionary',
    label: 'Visionary Brainstorm',
    shortLabel: 'Visionary',
    icon: '💡',
    tagline: 'Expansive opportunity focus',
    description: 'Explores breakthrough opportunities, creative leverage, and ambitious upside.',
    effect: 'Unlocks lateral possibilities, optimistic opportunity framing, and expansive creative exploration.',
    weights: { tone: 70, directness: 70, perspective: 90 },
    colors: {
      bg: 'bg-amber-500/10 dark:bg-amber-500/15',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-500/30',
      dot: 'bg-amber-500',
    },
  },
] as const;

/**
 * Dynamically resolves which preset matches the given SoulTuningConfig,
 * or returns null if the current weights represent a custom calibration.
 */
export function resolveActiveThinkingPreset(tuning?: SoulTuningConfig | null): ThinkingPreset | null {
  if (!tuning || typeof tuning !== 'object') {
    return THINKING_PRESETS[0]; // Default neutral
  }
  for (const preset of THINKING_PRESETS) {
    if (
      preset.weights.tone === tuning.tone &&
      preset.weights.directness === tuning.directness &&
      preset.weights.perspective === tuning.perspective
    ) {
      return preset;
    }
  }
  return null;
}

/**
 * Formats a short dynamic badge label for the active calibration.
 */
export function formatThinkingModeBadge(tuning?: SoulTuningConfig | null): {
  icon: string;
  label: string;
  isPreset: boolean;
  presetId?: ThinkingPresetId;
  effect: string;
  colors: ThinkingPresetColors;
} {
  const activePreset = resolveActiveThinkingPreset(tuning);
  if (activePreset) {
    return {
      icon: activePreset.icon,
      label: activePreset.shortLabel,
      isPreset: true,
      presetId: activePreset.id,
      effect: activePreset.effect,
      colors: activePreset.colors,
    };
  }

  const t = tuning?.tone ?? 50;
  const d = tuning?.directness ?? 50;
  const p = tuning?.perspective ?? 50;

  return {
    icon: '🎛️',
    label: `Custom (${t}/${d}/${p})`,
    isPreset: false,
    effect: `Custom calibration: Tone ${t}/100, Directness ${d}/100, Perspective ${p}/100.`,
    colors: {
      bg: 'bg-purple-500/10 dark:bg-purple-500/15',
      text: 'text-purple-700 dark:text-purple-300',
      border: 'border-purple-500/30',
      dot: 'bg-purple-500',
    },
  };
}
