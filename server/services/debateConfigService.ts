import { resolveBoundedIntegerSetting } from '../utils/researchEvidence.ts';

export type DebateFocusBias =
  | 'balanced'
  | 'risk_averse'
  | 'growth_aggressive'
  | 'capital_efficient'
  | 'regulatory_first'
  | 'speed_execution';

export const ALLOWED_DEBATE_FOCUS_BIASES: readonly DebateFocusBias[] = [
  'balanced',
  'risk_averse',
  'growth_aggressive',
  'capital_efficient',
  'regulatory_first',
  'speed_execution',
] as const;

export interface DebateFocusWeights {
  risk: number;
  growth: number;
  capital: number;
  speed: number;
  regulatory: number;
}

export interface DebatePersonaConfig {
  id: string;
  name: string;
  mandate: string;
  weight: number;
}

export interface DebateConfigInput {
  personaCount?: number | string;
  personas?: Array<{ name?: string; mandate?: string; weight?: number }> | string;
  rounds?: number | string;
  focusBias?: string;
  focusWeights?: Record<string, unknown> | string;
  constraints?: string[] | string;
}

export interface ResolvedDebateConfig {
  personaCount: number;
  rounds: number;
  focusBias: DebateFocusBias;
  focusWeights: DebateFocusWeights;
  personas: DebatePersonaConfig[];
  constraints: string[];
  clampedFields: string[];
  limits: {
    minPersonas: number;
    maxPersonas: number;
    minRounds: number;
    maxRounds: number;
  };
}

export type DebateConfigResolutionResult =
  | { ok: true; config: ResolvedDebateConfig }
  | { ok: false; code: string; error: string };

const BIAS_DEFAULT_WEIGHTS: Record<DebateFocusBias, DebateFocusWeights> = {
  balanced: { risk: 20, growth: 25, capital: 20, speed: 20, regulatory: 15 },
  risk_averse: { risk: 40, growth: 10, capital: 20, speed: 10, regulatory: 20 },
  growth_aggressive: { risk: 10, growth: 45, capital: 15, speed: 25, regulatory: 5 },
  capital_efficient: { risk: 20, growth: 15, capital: 40, speed: 15, regulatory: 10 },
  regulatory_first: { risk: 25, growth: 10, capital: 15, speed: 10, regulatory: 40 },
  speed_execution: { risk: 10, growth: 25, capital: 15, speed: 45, regulatory: 5 },
};

const PERSONA_ARCHETYPES: Record<string, Omit<DebatePersonaConfig, 'weight'>> = {
  velocity: {
    id: 'velocity',
    name: 'Lean Execution & Velocity',
    mandate: 'Argue for the fastest, highest-leverage execution path with minimal coordination drag and rapid empirical validation.',
  },
  risk: {
    id: 'risk',
    name: 'Downside & Risk Challenger',
    mandate: 'Challenge hidden assumptions, failure modes, irreversible downside, second-order blast radius, and execution fragility.',
  },
  capital: {
    id: 'capital',
    name: 'Unit Economics & Capital Steward',
    mandate: 'Scrutinize cash burn, payback horizon, opportunity cost, gross margins, and capital allocation discipline.',
  },
  regulatory: {
    id: 'regulatory',
    name: 'Regulatory & Compliance Architect',
    mandate: 'Surface statutory, privacy, licensing, auditability, security, and contractual governance blockers before commitment.',
  },
  customer: {
    id: 'customer',
    name: 'Customer & Market Adoption Advocate',
    mandate: 'Evaluate buyer friction, switching costs, positioning credibility, retention impact, and real willingness to pay.',
  },
};

const BIAS_PERSONA_PRIORITY: Record<DebateFocusBias, string[]> = {
  balanced: ['velocity', 'risk', 'capital', 'customer', 'regulatory'],
  risk_averse: ['risk', 'regulatory', 'capital', 'velocity', 'customer'],
  growth_aggressive: ['velocity', 'customer', 'capital', 'risk', 'regulatory'],
  capital_efficient: ['capital', 'risk', 'velocity', 'customer', 'regulatory'],
  regulatory_first: ['regulatory', 'risk', 'capital', 'customer', 'velocity'],
  speed_execution: ['velocity', 'customer', 'risk', 'capital', 'regulatory'],
};

function normalizeWeights(raw: Partial<Record<keyof DebateFocusWeights, number>>, fallback: DebateFocusWeights): DebateFocusWeights {
  const keys: Array<keyof DebateFocusWeights> = ['risk', 'growth', 'capital', 'speed', 'regulatory'];
  const nonNegative: Record<keyof DebateFocusWeights, number> = {
    risk: Number.isFinite(raw.risk) && (raw.risk as number) >= 0 ? (raw.risk as number) : fallback.risk,
    growth: Number.isFinite(raw.growth) && (raw.growth as number) >= 0 ? (raw.growth as number) : fallback.growth,
    capital: Number.isFinite(raw.capital) && (raw.capital as number) >= 0 ? (raw.capital as number) : fallback.capital,
    speed: Number.isFinite(raw.speed) && (raw.speed as number) >= 0 ? (raw.speed as number) : fallback.speed,
    regulatory: Number.isFinite(raw.regulatory) && (raw.regulatory as number) >= 0 ? (raw.regulatory as number) : fallback.regulatory,
  };

  const total = keys.reduce((sum, k) => sum + nonNegative[k], 0);
  if (total <= 0) {
    return { ...fallback };
  }

  const normalized: DebateFocusWeights = {
    risk: Math.round((nonNegative.risk / total) * 100),
    growth: Math.round((nonNegative.growth / total) * 100),
    capital: Math.round((nonNegative.capital / total) * 100),
    speed: Math.round((nonNegative.speed / total) * 100),
    regulatory: Math.round((nonNegative.regulatory / total) * 100),
  };

  const roundedSum = keys.reduce((sum, k) => sum + normalized[k], 0);
  const diff = 100 - roundedSum;
  if (diff !== 0) {
    const dominantKey = keys.reduce((best, k) => (nonNegative[k] > nonNegative[best] ? k : best), keys[0]);
    normalized[dominantKey] = Math.max(0, normalized[dominantKey] + diff);
  }
  return normalized;
}

function parseConstraintsList(raw?: string[] | string): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 12);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 12);
        }
      } catch {
        // Treat non-JSON text as newline/semicolon delimited constraints
      }
    }
    return trimmed
      .split(/\n|;/)
      .map((c) => c.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

export function resolveDebateConfiguration(
  rawInput?: DebateConfigInput,
  env: NodeJS.ProcessEnv = process.env,
): DebateConfigResolutionResult {
  const minPersonas = 2;
  const maxPersonas = resolveBoundedIntegerSetting(env, 'TWINMIND_DEBATE_MAX_PERSONAS', 4, 2, 5);
  const minRounds = 1;
  const maxRounds = resolveBoundedIntegerSetting(env, 'TWINMIND_DEBATE_MAX_ROUNDS', 3, 1, 3);
  const clampedFields: string[] = [];

  // 1. Focus bias
  let focusBias: DebateFocusBias = 'balanced';
  if (rawInput?.focusBias !== undefined && rawInput.focusBias !== null && String(rawInput.focusBias).trim() !== '') {
    const normalizedBias = String(rawInput.focusBias).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!ALLOWED_DEBATE_FOCUS_BIASES.includes(normalizedBias as DebateFocusBias)) {
      return {
        ok: false,
        code: 'DEBATE_INVALID_FOCUS_BIAS',
        error: `Invalid focusBias "${rawInput.focusBias}". Allowed values: ${ALLOWED_DEBATE_FOCUS_BIASES.join(', ')}.`,
      };
    }
    focusBias = normalizedBias as DebateFocusBias;
  }

  // 2. Focus weights
  let rawWeightsObj: Record<string, unknown> = {};
  if (rawInput?.focusWeights !== undefined && rawInput.focusWeights !== null && rawInput.focusWeights !== '') {
    if (typeof rawInput.focusWeights === 'string') {
      try {
        const parsed = JSON.parse(rawInput.focusWeights);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return {
            ok: false,
            code: 'DEBATE_INVALID_FOCUS_WEIGHTS',
            error: 'focusWeightsJson must decode to a JSON object of numeric dimension weights.',
          };
        }
        rawWeightsObj = parsed as Record<string, unknown>;
      } catch {
        return {
          ok: false,
          code: 'DEBATE_INVALID_FOCUS_WEIGHTS',
          error: 'focusWeightsJson is not valid JSON.',
        };
      }
    } else if (typeof rawInput.focusWeights === 'object' && !Array.isArray(rawInput.focusWeights)) {
      rawWeightsObj = rawInput.focusWeights;
    } else {
      return {
        ok: false,
        code: 'DEBATE_INVALID_FOCUS_WEIGHTS',
        error: 'focusWeights must be a JSON object or JSON object string.',
      };
    }
  }

  const baseWeights = BIAS_DEFAULT_WEIGHTS[focusBias];
  const parsedWeightOverrides: Partial<Record<keyof DebateFocusWeights, number>> = {};
  for (const key of ['risk', 'growth', 'capital', 'speed', 'regulatory'] as const) {
    if (rawWeightsObj[key] !== undefined) {
      const n = Number(rawWeightsObj[key]);
      if (!Number.isFinite(n) || n < 0) {
        return {
          ok: false,
          code: 'DEBATE_INVALID_FOCUS_WEIGHTS',
          error: `Weight for "${key}" must be a non-negative finite number.`,
        };
      }
      parsedWeightOverrides[key] = n;
    }
  }
  const focusWeights = normalizeWeights(parsedWeightOverrides, baseWeights);

  // 3. Parse optional custom personas
  let customPersonasInput: Array<{ name?: string; mandate?: string; weight?: number }> = [];
  if (rawInput?.personas !== undefined && rawInput.personas !== null && rawInput.personas !== '') {
    let rawArray: unknown = rawInput.personas;
    if (typeof rawInput.personas === 'string') {
      try {
        rawArray = JSON.parse(rawInput.personas);
      } catch {
        return {
          ok: false,
          code: 'DEBATE_INVALID_PERSONAS_JSON',
          error: 'personas must be a valid JSON array of { name, mandate, weight? } objects.',
        };
      }
    }
    if (!Array.isArray(rawArray)) {
      return {
        ok: false,
        code: 'DEBATE_INVALID_PERSONAS',
        error: 'personas must be an array of { name, mandate, weight? } objects.',
      };
    }
    customPersonasInput = rawArray as Array<{ name?: string; mandate?: string; weight?: number }>;
  }

  // 4. Resolve rounds
  let rounds = 1;
  if (rawInput?.rounds !== undefined && rawInput.rounds !== null && String(rawInput.rounds).trim() !== '') {
    const parsedRounds = Math.trunc(Number(rawInput.rounds));
    if (!Number.isFinite(parsedRounds)) {
      return {
        ok: false,
        code: 'DEBATE_INVALID_ROUNDS',
        error: 'rounds must be a valid integer.',
      };
    }
    if (parsedRounds < minRounds) {
      clampedFields.push(`rounds clamped from ${parsedRounds} to minimum ${minRounds}`);
      rounds = minRounds;
    } else if (parsedRounds > maxRounds) {
      clampedFields.push(`rounds clamped from ${parsedRounds} to configured maximum ${maxRounds}`);
      rounds = maxRounds;
    } else {
      rounds = parsedRounds;
    }
  }

  // 5. Resolve persona count and assemble personas list
  let requestedPersonaCount = customPersonasInput.length >= 2 ? customPersonasInput.length : 2;
  if (rawInput?.personaCount !== undefined && rawInput.personaCount !== null && String(rawInput.personaCount).trim() !== '') {
    const parsedCount = Math.trunc(Number(rawInput.personaCount));
    if (!Number.isFinite(parsedCount)) {
      return {
        ok: false,
        code: 'DEBATE_INVALID_PERSONA_COUNT',
        error: 'personaCount must be a valid integer.',
      };
    }
    requestedPersonaCount = parsedCount;
  }

  let personaCount = requestedPersonaCount;
  if (personaCount < minPersonas) {
    clampedFields.push(`personaCount clamped from ${personaCount} to minimum ${minPersonas}`);
    personaCount = minPersonas;
  } else if (personaCount > maxPersonas) {
    clampedFields.push(`personaCount clamped from ${personaCount} to configured maximum ${maxPersonas}`);
    personaCount = maxPersonas;
  }

  const personas: DebatePersonaConfig[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < customPersonasInput.length && personas.length < personaCount; i++) {
    const item = customPersonasInput[i];
    const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : `Custom Analyst ${i + 1}`;
    const mandate = typeof item?.mandate === 'string' && item.mandate.trim()
      ? item.mandate.trim()
      : 'Provide an independent, evidence-grounded strategic critique tailored to this dilemma.';
    const weight = Number.isFinite(Number(item?.weight)) && Number(item?.weight) > 0
      ? Number(item?.weight)
      : 1;
    usedNames.add(name.toLowerCase());
    personas.push({
      id: `custom_${i + 1}`,
      name,
      mandate,
      weight,
    });
  }

  const archetypeOrder = BIAS_PERSONA_PRIORITY[focusBias];
  for (const key of archetypeOrder) {
    if (personas.length >= personaCount) break;
    const arch = PERSONA_ARCHETYPES[key];
    if (usedNames.has(arch.name.toLowerCase())) continue;
    const weightFromBias =
      key === 'risk'
        ? focusWeights.risk
        : key === 'velocity'
          ? focusWeights.speed
          : key === 'capital'
            ? focusWeights.capital
            : key === 'regulatory'
              ? focusWeights.regulatory
              : focusWeights.growth;
    personas.push({
      id: arch.id,
      name: arch.name,
      mandate: arch.mandate,
      weight: Math.max(10, weightFromBias),
    });
  }

  // Normalize persona weights to sum to 100
  const rawWeightSum = personas.reduce((s, p) => s + p.weight, 0);
  if (rawWeightSum > 0) {
    let running = 0;
    for (let i = 0; i < personas.length; i++) {
      if (i === personas.length - 1) {
        personas[i].weight = Math.max(1, 100 - running);
      } else {
        personas[i].weight = Math.max(1, Math.round((personas[i].weight / rawWeightSum) * 100));
        running += personas[i].weight;
      }
    }
  }

  const constraints = parseConstraintsList(rawInput?.constraints);

  return {
    ok: true,
    config: {
      personaCount: personas.length,
      rounds,
      focusBias,
      focusWeights,
      personas,
      constraints,
      clampedFields,
      limits: {
        minPersonas,
        maxPersonas,
        minRounds,
        maxRounds,
      },
    },
  };
}
