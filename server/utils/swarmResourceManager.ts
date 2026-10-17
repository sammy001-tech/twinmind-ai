/**
 * Multi-Agent Specialist Swarm Resource & Lifecycle Manager (Milestone 1)
 * Enforces:
 * 1. Runtime-configured, bounded global tool-call budget (retries included)
 * 2. Root AbortController + AbortSignal.any() with a runtime-configured deadline
 * 3. Provider-specific circuit breakers (Tavily, Gemini, Neon)
 * 4. Observable status taxonomy ('running', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'timed_out')
 * 5. Immediate late-result discard after termination
 */

import { resolveBoundedIntegerSetting } from './researchEvidence.ts';

export type SwarmSessionStatus =
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export class SwarmBudgetExceededError extends Error {
  constructor(message = 'SWARM_BUDGET_EXHAUSTED: the configured global tool-call budget was reached for this session.') {
    super(message);
    this.name = 'SwarmBudgetExceededError';
  }
}

export class SwarmCircuitBreakerOpenError extends Error {
  constructor(provider: string, cooldownRemainingMs: number) {
    super(`CIRCUIT_BREAKER_OPEN: Provider '${provider}' is cooling down (${Math.ceil(cooldownRemainingMs / 1000)}s remaining).`);
    this.name = 'SwarmCircuitBreakerOpenError';
  }
}

/**
 * Atomic Tool-Call Budget for a single swarm session
 */
export class SwarmToolBudget {
  private readonly maxCalls: number;
  private callsUsed = 0;
  private readonly history: Array<{ tool: string; timestamp: number; attempt: number }> = [];

  constructor(maxCalls = 6) {
    this.maxCalls = maxCalls;
  }

  public claim(toolName: string, attempt = 1): void {
    if (this.callsUsed >= this.maxCalls) {
      throw new SwarmBudgetExceededError(
        `SWARM_BUDGET_EXHAUSTED: Cannot execute tool '${toolName}' (attempt ${attempt}). Budget of ${this.maxCalls} calls is exhausted.`
      );
    }
    this.callsUsed++;
    this.history.push({ tool: toolName, timestamp: Date.now(), attempt });
  }

  public getUsed(): number {
    return this.callsUsed;
  }

  public getRemaining(): number {
    return Math.max(0, this.maxCalls - this.callsUsed);
  }

  public getMax(): number {
    return this.maxCalls;
  }

  public getHistory() {
    return [...this.history];
  }
}

/**
 * Provider-Specific Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN)
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface ProviderState {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveRateLimits: number;
  lastFailureTime: number;
  halfOpenInFlight: boolean;
}

export class ProviderCircuitBreakerRegistry {
  private providers = new Map<string, ProviderState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(failureThreshold = 3, cooldownMs = 60_000) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
  }

  private getOrCreate(provider: string): ProviderState {
    let state = this.providers.get(provider);
    if (!state) {
      state = {
        state: 'CLOSED',
        consecutiveFailures: 0,
        consecutiveRateLimits: 0,
        lastFailureTime: 0,
        halfOpenInFlight: false,
      };
      this.providers.set(provider, state);
    }
    return state;
  }

  public checkCanExecute(provider: string): { canExecute: boolean; reason?: string } {
    const s = this.getOrCreate(provider);
    const now = Date.now();

    if (s.state === 'OPEN') {
      const elapsed = now - s.lastFailureTime;
      if (elapsed >= this.cooldownMs) {
        // Transition to HALF_OPEN to probe recovery
        s.state = 'HALF_OPEN';
        s.halfOpenInFlight = true;
        return { canExecute: true };
      }
      const remainingMs = this.cooldownMs - elapsed;
      return {
        canExecute: false,
        reason: `CIRCUIT_BREAKER_OPEN: Provider '${provider}' cooling down. ${Math.ceil(remainingMs / 1000)}s remaining.`,
      };
    }

    if (s.state === 'HALF_OPEN') {
      // Only permit single probe at a time
      if (s.halfOpenInFlight) {
        return {
          canExecute: false,
          reason: `CIRCUIT_BREAKER_HALF_OPEN: Probe already in flight for provider '${provider}'.`,
        };
      }
      s.halfOpenInFlight = true;
      return { canExecute: true };
    }

    return { canExecute: true };
  }

  public recordSuccess(provider: string): void {
    const s = this.getOrCreate(provider);
    s.consecutiveFailures = 0;
    s.consecutiveRateLimits = 0;
    s.halfOpenInFlight = false;
    s.state = 'CLOSED';
  }

  public recordFailure(provider: string, status?: number, errorMessage?: string): void {
    const s = this.getOrCreate(provider);
    s.lastFailureTime = Date.now();
    s.halfOpenInFlight = false;

    // Distinguish 429 rate limit vs 5xx service failure
    if (status === 429) {
      s.consecutiveRateLimits++;
      // If repeated 429s persist beyond threshold, open breaker
      if (s.consecutiveRateLimits >= this.failureThreshold) {
        s.state = 'OPEN';
      }
    } else {
      // Standard 5xx or network transport error
      s.consecutiveFailures++;
      if (s.consecutiveFailures >= this.failureThreshold || s.state === 'HALF_OPEN') {
        s.state = 'OPEN';
      }
    }
  }

  public reset(provider?: string): void {
    if (provider) {
      this.providers.delete(provider);
    } else {
      this.providers.clear();
    }
  }

  public getState(provider: string): CircuitState {
    return this.getOrCreate(provider).state;
  }
}

export const circuitBreakers = new ProviderCircuitBreakerRegistry(3, 60_000);

/**
 * Combined Signal & Cancellation Context for Swarm Session
 */
export interface SwarmSessionExecutionScope {
  sessionId: string;
  userId: string;
  tenantId: string;
  channel: 'web' | 'telegram' | 'whatsapp';
  budget: SwarmToolBudget;
  manualController: AbortController;
  timeoutSignal: AbortSignal;
  combinedSignal: AbortSignal;
  isTerminated: boolean;
  status: SwarmSessionStatus;
  startTime: number;
}

export class SwarmSessionRegistry {
  private activeSessions = new Map<string, SwarmSessionExecutionScope>();

  public createSessionScope(options: {
    sessionId: string;
    userId?: string;
    tenantId?: string;
    channel?: 'web' | 'telegram' | 'whatsapp';
    deadlineMs?: number;
    externalSignal?: AbortSignal;
  }): SwarmSessionExecutionScope {
    const {
      sessionId,
      userId = 'authenticated-owner',
      tenantId = 'single-owner-workspace',
      channel = 'web',
      deadlineMs = resolveBoundedIntegerSetting(process.env, 'TWINMIND_SWARM_DEADLINE_MS', 75_000, 10_000, 300_000),
      externalSignal,
    } = options;

    const manualController = new AbortController();
    const timeoutSignal = AbortSignal.timeout(deadlineMs);

    // Combine manual controller, timeout, and any external signal using AbortSignal.any()
    const signalsToCombine: AbortSignal[] = [manualController.signal, timeoutSignal];
    if (externalSignal) {
      signalsToCombine.push(externalSignal);
    }

    const combinedSignal = AbortSignal.any(signalsToCombine);

    const budget = new SwarmToolBudget(
      resolveBoundedIntegerSetting(process.env, 'TWINMIND_SWARM_TOOL_BUDGET', 12, 6, 40),
    );

    const scope: SwarmSessionExecutionScope = {
      sessionId,
      userId,
      tenantId,
      channel,
      budget,
      manualController,
      timeoutSignal,
      combinedSignal,
      isTerminated: false,
      status: 'running',
      startTime: Date.now(),
    };

    // When combinedSignal aborts, mark terminated immediately to discard late results
    combinedSignal.addEventListener(
      'abort',
      () => {
        scope.isTerminated = true;
        if (manualController.signal.aborted || externalSignal?.aborted) {
          scope.status = 'cancelled';
        } else if (timeoutSignal.aborted) {
          scope.status = 'timed_out';
        }
      },
      { once: true }
    );

    this.activeSessions.set(sessionId, scope);
    return scope;
  }

  public getSession(sessionId: string): SwarmSessionExecutionScope | undefined {
    return this.activeSessions.get(sessionId);
  }

  public cancelSession(sessionId: string, requestedByUserId?: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    // Security boundary: if requestedByUserId is provided, verify ownership
    if (requestedByUserId && session.userId !== requestedByUserId) {
      throw new Error(`UNAUTHORIZED_CANCELLATION: User '${requestedByUserId}' does not own session '${sessionId}'.`);
    }

    session.isTerminated = true;
    session.status = 'cancelled';
    session.manualController.abort();
    return true;
  }

  public cancelActiveUserSession(userId: string, channel?: 'web' | 'telegram' | 'whatsapp'): string | null {
    for (const [id, session] of this.activeSessions.entries()) {
      if (session.userId === userId && (!channel || session.channel === channel) && !session.isTerminated) {
        this.cancelSession(id, userId);
        return id;
      }
    }
    return null;
  }

  public finalizeSession(sessionId: string, finalStatus?: SwarmSessionStatus): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isTerminated = true;
      if (finalStatus && session.status === 'running') {
        session.status = finalStatus;
      }
      this.activeSessions.delete(sessionId);
    }
  }

  public getActiveCount(): number {
    return this.activeSessions.size;
  }
}

export const swarmSessionRegistry = new SwarmSessionRegistry();
