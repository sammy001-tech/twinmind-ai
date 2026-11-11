import { ThinkingLevel } from '../types/index.ts';

export interface ThinkingLevelOption {
  id: ThinkingLevel;
  label: string;
  description: string;
}

export const THINKING_LEVEL_OPTIONS: readonly ThinkingLevelOption[] = [
  {
    id: 'low',
    label: 'Low',
    description: 'Fast and efficient',
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Balanced depth',
  },
  {
    id: 'high',
    label: 'High',
    description: 'Extra thorough',
  },
] as const;

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'low';

export function isValidThinkingLevel(value: unknown): value is ThinkingLevel {
  return value === 'low' || value === 'medium' || value === 'high';
}

export function resolveThinkingLevel(value: unknown): ThinkingLevel {
  if (isValidThinkingLevel(value)) {
    return value;
  }
  return DEFAULT_THINKING_LEVEL;
}

export function getThinkingLevelOption(level: ThinkingLevel): ThinkingLevelOption {
  const found = THINKING_LEVEL_OPTIONS.find((opt) => opt.id === level);
  return found || THINKING_LEVEL_OPTIONS[0];
}
