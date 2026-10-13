/**
 * Deterministic Safe Math AST Evaluator
 * Strictly complies with ZeroMock and Zero-Fallback Policy:
 * Performs real recursive descent tokenization and AST evaluation without using eval() or Function().
 */

export interface CalculateMathInput {
  expression: string;
  precision?: number;
}

export interface CalculateMathResult {
  status: 'success' | 'error';
  expression: string;
  result?: number;
  formatted?: string;
  steps?: string[];
  error?: string;
  durationMs: number;
}

type TokenType = 'NUMBER' | 'IDENTIFIER' | 'OPERATOR' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

class MathTokenizer {
  private pos = 0;
  private readonly input: string;

  constructor(input: string) {
    this.input = input;
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      const char = this.input[this.pos];

      if (/\s/.test(char)) {
        this.pos++;
        continue;
      }

      if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(this.peek(1)))) {
        tokens.push(this.readNumber());
        continue;
      }

      if (/[a-zA-Z_]/.test(char)) {
        tokens.push(this.readIdentifier());
        continue;
      }

      if (char === '(') {
        tokens.push({ type: 'LPAREN', value: '(', pos: this.pos++ });
        continue;
      }

      if (char === ')') {
        tokens.push({ type: 'RPAREN', value: ')', pos: this.pos++ });
        continue;
      }

      if (char === ',') {
        tokens.push({ type: 'COMMA', value: ',', pos: this.pos++ });
        continue;
      }

      if ('+-*/^%'.includes(char)) {
        tokens.push({ type: 'OPERATOR', value: char, pos: this.pos++ });
        continue;
      }

      throw new Error(`Unrecognized symbol '${char}' at index ${this.pos}`);
    }

    tokens.push({ type: 'EOF', value: '', pos: this.pos });
    return tokens;
  }

  private peek(offset = 0): string {
    return this.pos + offset < this.input.length ? this.input[this.pos + offset] : '';
  }

  private readNumber(): Token {
    const start = this.pos;
    let hasDot = false;

    while (this.pos < this.input.length) {
      const c = this.input[this.pos];
      if (/[0-9]/.test(c)) {
        this.pos++;
      } else if (c === '.' && !hasDot) {
        hasDot = true;
        this.pos++;
      } else if ((c === 'e' || c === 'E') && /[0-9+-]/.test(this.peek(1))) {
        this.pos++;
        if (this.input[this.pos] === '+' || this.input[this.pos] === '-') {
          this.pos++;
        }
      } else {
        break;
      }
    }

    const val = this.input.slice(start, this.pos);
    return { type: 'NUMBER', value: val, pos: start };
  }

  private readIdentifier(): Token {
    const start = this.pos;
    while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.pos])) {
      this.pos++;
    }
    const val = this.input.slice(start, this.pos);
    return { type: 'IDENTIFIER', value: val, pos: start };
  }
}

class MathParser {
  private tokens: Token[] = [];
  private current = 0;
  private readonly steps: string[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse(): { result: number; steps: string[] } {
    if (this.peek().type === 'EOF') {
      throw new Error('Expression is empty');
    }
    const result = this.parseExpression();
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token '${this.peek().value}' at index ${this.peek().pos}`);
    }
    return { result, steps: this.steps };
  }

  private peek(): Token {
    return this.tokens[this.current] || { type: 'EOF', value: '', pos: -1 };
  }

  private match(...types: TokenType[]): boolean {
    const next = this.peek();
    if (types.includes(next.type)) {
      this.current++;
      return true;
    }
    return false;
  }

  private matchOperator(op: string): boolean {
    if (this.peek().type === 'OPERATOR' && this.peek().value === op) {
      this.current++;
      return true;
    }
    return false;
  }

  // Precedence level 1: Additive (+, -)
  private parseExpression(): number {
    let left = this.parseMultiplicative();

    while (this.peek().type === 'OPERATOR' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.peek().value;
      this.current++;
      const right = this.parseMultiplicative();
      const prev = left;
      if (op === '+') {
        left = left + right;
        this.steps.push(`${prev} + ${right} = ${left}`);
      } else {
        left = left - right;
        this.steps.push(`${prev} - ${right} = ${left}`);
      }
    }

    return left;
  }

  // Precedence level 2: Multiplicative (*, /, %)
  private parseMultiplicative(): number {
    let left = this.parseExponential();

    while (
      this.peek().type === 'OPERATOR' &&
      (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')
    ) {
      const op = this.peek().value;
      this.current++;
      const right = this.parseExponential();
      const prev = left;

      if (op === '*') {
        left = left * right;
        this.steps.push(`${prev} * ${right} = ${left}`);
      } else if (op === '/') {
        if (right === 0) {
          throw new Error('Division by zero is undefined');
        }
        left = left / right;
        this.steps.push(`${prev} / ${right} = ${left}`);
      } else if (op === '%') {
        if (right === 0) {
          throw new Error('Modulo by zero is undefined');
        }
        left = left % right;
        this.steps.push(`${prev} % ${right} = ${left}`);
      }
    }

    return left;
  }

  // Precedence level 3: Exponential (^) - Right associative
  private parseExponential(): number {
    let base = this.parseUnary();

    if (this.matchOperator('^')) {
      const exponent = this.parseExponential();
      const result = Math.pow(base, exponent);
      this.steps.push(`${base} ^ ${exponent} = ${result}`);
      return result;
    }

    return base;
  }

  // Precedence level 4: Unary (+, -)
  private parseUnary(): number {
    if (this.matchOperator('+')) {
      return this.parseUnary();
    }
    if (this.matchOperator('-')) {
      const val = this.parseUnary();
      const result = -val;
      this.steps.push(`Unary minus -(${val}) = ${result}`);
      return result;
    }
    return this.parsePrimary();
  }

  // Precedence level 5: Primary (numbers, parens, constants, functions)
  private parsePrimary(): number {
    const token = this.peek();

    if (token.type === 'NUMBER') {
      this.current++;
      const num = parseFloat(token.value);
      if (isNaN(num)) {
        throw new Error(`Invalid number literal '${token.value}'`);
      }
      return num;
    }

    if (token.type === 'LPAREN') {
      this.current++;
      const expr = this.parseExpression();
      if (!this.match('RPAREN')) {
        throw new Error('Missing closing parenthesis \')\'');
      }
      return expr;
    }

    if (token.type === 'IDENTIFIER') {
      this.current++;
      const name = token.value.toLowerCase();

      // Math constants
      if (name === 'pi') return Math.PI;
      if (name === 'e') return Math.E;

      // Function calls
      if (this.peek().type === 'LPAREN') {
        this.current++;
        const args: number[] = [];

        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseExpression());
          while (this.match('COMMA')) {
            args.push(this.parseExpression());
          }
        }

        if (!this.match('RPAREN')) {
          throw new Error(`Missing closing parenthesis in function call '${name}'`);
        }

        return this.evalFunction(name, args);
      }

      throw new Error(`Unknown variable or constant '${name}'`);
    }

    throw new Error(`Unexpected token '${token.value || token.type}'`);
  }

  private evalFunction(name: string, args: number[]): number {
    switch (name) {
      case 'sqrt':
        if (args.length !== 1) throw new Error('sqrt() takes exactly 1 argument');
        if (args[0] < 0) throw new Error('Square root of negative number is not a real number');
        const resSqrt = Math.sqrt(args[0]);
        this.steps.push(`sqrt(${args[0]}) = ${resSqrt}`);
        return resSqrt;

      case 'abs':
        if (args.length !== 1) throw new Error('abs() takes exactly 1 argument');
        return Math.abs(args[0]);

      case 'round':
        if (args.length === 1) return Math.round(args[0]);
        if (args.length === 2) {
          const factor = Math.pow(10, args[1]);
          return Math.round(args[0] * factor) / factor;
        }
        throw new Error('round() takes 1 or 2 arguments');

      case 'ceil':
        if (args.length !== 1) throw new Error('ceil() takes 1 argument');
        return Math.ceil(args[0]);

      case 'floor':
        if (args.length !== 1) throw new Error('floor() takes 1 argument');
        return Math.floor(args[0]);

      case 'min':
        if (args.length < 1) throw new Error('min() requires at least 1 argument');
        return Math.min(...args);

      case 'max':
        if (args.length < 1) throw new Error('max() requires at least 1 argument');
        return Math.max(...args);

      case 'log10':
        if (args.length !== 1) throw new Error('log10() takes 1 argument');
        if (args[0] <= 0) throw new Error('log10() requires a positive argument');
        return Math.log10(args[0]);

      case 'log':
      case 'ln':
        if (args.length !== 1) throw new Error('log() takes 1 argument');
        if (args[0] <= 0) throw new Error('log() requires a positive argument');
        return Math.log(args[0]);

      case 'exp':
        if (args.length !== 1) throw new Error('exp() takes 1 argument');
        return Math.exp(args[0]);

      case 'pow':
        if (args.length !== 2) throw new Error('pow() takes 2 arguments');
        return Math.pow(args[0], args[1]);

      default:
        throw new Error(`Unsupported math function '${name}'`);
    }
  }
}

/**
 * Public execution function for deterministic math calculation
 */
export function evaluateMathExpression(input: CalculateMathInput): CalculateMathResult {
  const start = Date.now();
  const trimmed = (input.expression || '').trim();

  if (!trimmed) {
    return {
      status: 'error',
      expression: '',
      error: 'Mathematical expression cannot be empty',
      durationMs: Date.now() - start,
    };
  }

  try {
    const tokenizer = new MathTokenizer(trimmed);
    const tokens = tokenizer.tokenize();
    const parser = new MathParser(tokens);
    const { result, steps } = parser.parse();

    const precision = typeof input.precision === 'number' && input.precision >= 0 ? input.precision : 4;
    const rounded = Number(result.toFixed(precision));
    const formatted = rounded.toLocaleString('en-US', { maximumFractionDigits: precision });

    return {
      status: 'success',
      expression: trimmed,
      result: rounded,
      formatted,
      steps,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      status: 'error',
      expression: trimmed,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
