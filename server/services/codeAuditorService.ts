/**
 * Code & Security Auditor Specialist Service (Milestone 2)
 * Pure TypeScript Compiler API AST analysis. Zero eval, zero external runtime execution.
 * Rules:
 * - SEC-001: Hardcoded Secrets (Shannon entropy > 4.5 & token regex patterns, strict test allowlist)
 * - SEC-002: SQL Injection Vulnerability (Unsafe string concatenation/interpolation in query calls)
 * - SEC-003: Unsafe Code Evaluation (eval, new Function, string setTimeout/setInterval)
 * - SEC-004: Excessive Cyclomatic Complexity (McCabe M > 15 across function node types)
 */

import ts from 'typescript';

export type RuleId = 'SEC-001' | 'SEC-002' | 'SEC-003' | 'SEC-004';
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type FindingConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type FindingStatus = 'confirmed' | 'needs_review';

export interface CodeAuditFinding {
  ruleId: RuleId;
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  status: FindingStatus;
  snippet: string;
  explanation: string;
  remediation: string;
}

export interface CodeAuditReport {
  filePath: string;
  findings: CodeAuditFinding[];
  summary: {
    totalIssues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  securityNotice: string;
  durationMs: number;
}

const KNOWN_DUMMY_ALLOWLIST = new Set([
  'AKIAIOSFODNN7EXAMPLE',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  'sk_test_4eC39HqLyjWDarjtT1zdp7dc',
]);

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp; severity: FindingSeverity }> = [
  { name: 'AWS Access Key ID', regex: /\b(AKIA[0-9A-Z]{16})\b/, severity: 'CRITICAL' },
  { name: 'Stripe Secret Key', regex: /\b(sk_(?:live|test)_[0-9a-zA-Z]{24,34})\b/, severity: 'CRITICAL' },
  { name: 'GitHub Personal Token', regex: /\b(gh[pousr]_[0-9a-zA-Z]{36,40})\b/, severity: 'CRITICAL' },
  { name: 'Slack Bot/User Token', regex: /\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b/, severity: 'HIGH' },
  { name: 'Private Key Header', regex: /-----BEGIN (?:RSA|EC|DSA|OPENSSH)? PRIVATE KEY-----/, severity: 'CRITICAL' },
];

const DB_QUERY_IDENTIFIERS = new Set([
  'query',
  'raw',
  'execute',
  'exec',
  'run',
  'sql',
]);

export class CodeAuditorService {
  /**
   * Calculate Shannon entropy for a given string
   */
  public calculateShannonEntropy(str: string): number {
    if (!str || str.length === 0) return 0;
    const freq = new Map<string, number>();
    for (const char of str) {
      freq.set(char, (freq.get(char) || 0) + 1);
    }
    let entropy = 0;
    const len = str.length;
    for (const count of freq.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  /**
   * Check if a file path is in an authorized test fixture directory
   */
  private isTestPath(filePath: string): boolean {
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    return (
      norm.includes('/fixtures/') ||
      norm.includes('/__tests__/') ||
      norm.includes('/tests/') ||
      norm.endsWith('.test.ts') ||
      norm.endsWith('.spec.ts') ||
      norm.endsWith('.test.js') ||
      norm.endsWith('.spec.js')
    );
  }

  /**
   * Perform comprehensive AST audit of source code
   */
  public auditSourceCode(sourceCode: string, filePath = 'snippet.ts'): CodeAuditReport {
    const startTime = Date.now();
    const findings: CodeAuditFinding[] = [];
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const isTestFile = this.isTestPath(filePath);

    const getLineAndChar = (pos: number) => {
      const lc = sourceFile.getLineAndCharacterOfPosition(pos);
      return { line: lc.line + 1, column: lc.character + 1 };
    };

    const addFinding = (
      node: ts.Node,
      finding: Omit<CodeAuditFinding, 'filePath' | 'line' | 'column' | 'endLine' | 'endColumn' | 'snippet'>
    ) => {
      const start = getLineAndChar(node.getStart(sourceFile));
      const end = getLineAndChar(node.getEnd());
      const snippet = node.getText(sourceFile).slice(0, 120);
      findings.push({
        ...finding,
        filePath,
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
        snippet,
      });
    };

    // Helper: calculate McCabe Cyclomatic Complexity for a function node
    const calculateCyclomaticComplexity = (fnNode: ts.Node): number => {
      let complexity = 1;
      const visitFunctionBody = (child: ts.Node) => {
        // Do not recurse into nested function bodies
        if (
          child !== fnNode &&
          (ts.isFunctionDeclaration(child) ||
            ts.isFunctionExpression(child) ||
            ts.isArrowFunction(child) ||
            ts.isMethodDeclaration(child))
        ) {
          return;
        }

        switch (child.kind) {
          case ts.SyntaxKind.IfStatement:
          case ts.SyntaxKind.ConditionalExpression: // ternary ? :
          case ts.SyntaxKind.WhileStatement:
          case ts.SyntaxKind.DoStatement:
          case ts.SyntaxKind.ForStatement:
          case ts.SyntaxKind.ForInStatement:
          case ts.SyntaxKind.ForOfStatement:
          case ts.SyntaxKind.CatchClause:
            complexity++;
            break;

          case ts.SyntaxKind.CaseClause:
            // Switch case (excluding default clause)
            complexity++;
            break;

          case ts.SyntaxKind.BinaryExpression: {
            const bin = child as ts.BinaryExpression;
            const op = bin.operatorToken.kind;
            if (
              op === ts.SyntaxKind.AmpersandAmpersandToken || // &&
              op === ts.SyntaxKind.BarBarToken || // ||
              op === ts.SyntaxKind.QuestionQuestionToken // ??
            ) {
              complexity++;
            }
            break;
          }
        }
        ts.forEachChild(child, visitFunctionBody);
      };

      ts.forEachChild(fnNode, visitFunctionBody);
      return complexity;
    };

    // Helper: check if a node represents database query execution
    const isDbQueryCall = (call: ts.CallExpression): boolean => {
      const expr = call.expression;
      if (ts.isPropertyAccessExpression(expr)) {
        return DB_QUERY_IDENTIFIERS.has(expr.name.text);
      }
      if (ts.isIdentifier(expr)) {
        return DB_QUERY_IDENTIFIERS.has(expr.text);
      }
      return false;
    };

    // Main AST Visitor
    const visit = (node: ts.Node) => {
      // -------------------------------------------------------------
      // RULE SEC-001: Hardcoded Secrets
      // -------------------------------------------------------------
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const text = node.text;

        // Skip known dummy sample keys in fixtures/tests
        if (!KNOWN_DUMMY_ALLOWLIST.has(text) && !isTestFile) {
          for (const pattern of SECRET_PATTERNS) {
            if (pattern.regex.test(text)) {
              addFinding(node, {
                ruleId: 'SEC-001',
                severity: pattern.severity,
                confidence: 'HIGH',
                status: 'confirmed',
                explanation: `Potential hardcoded secret detected: matches pattern for ${pattern.name}.`,
                remediation: `Remove credential from source code and load via environment variables (process.env) or a secret manager.`,
              });
              break;
            }
          }

          // Check Shannon entropy for long unformatted tokens
          if (text.length >= 24 && !text.includes(' ') && !text.includes('/') && !text.includes(':')) {
            const entropy = this.calculateShannonEntropy(text);
            if (entropy > 4.6) {
              // High-entropy random key
              addFinding(node, {
                ruleId: 'SEC-001',
                severity: 'HIGH',
                confidence: 'MEDIUM',
                status: 'needs_review',
                explanation: `High Shannon entropy token detected (${entropy.toFixed(2)} bits/char, length ${text.length}). May be a hardcoded API token or private key.`,
                remediation: `Audit this string literal; move any live secret to environment variables.`,
              });
            }
          }
        }
      }

      // -------------------------------------------------------------
      // RULE SEC-002: SQL Injection Vulnerability
      // -------------------------------------------------------------
      if (ts.isCallExpression(node) && isDbQueryCall(node)) {
        const firstArg = node.arguments[0];
        if (firstArg) {
          // Unsafe binary string concatenation: query("SELECT ... " + id)
          if (ts.isBinaryExpression(firstArg) && firstArg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            addFinding(firstArg, {
              ruleId: 'SEC-002',
              severity: 'CRITICAL',
              confidence: 'HIGH',
              status: 'confirmed',
              explanation: `SQL query constructed via string concatenation (+). Untrusted input may alter SQL query semantics (SQL Injection).`,
              remediation: `Use parameterized queries ($1, $2 with parameters array) or an ORM prepared statement rather than string concatenation.`,
            });
          }
          // Unsafe non-tagged template literal: query(`SELECT ... ${id}`)
          else if (ts.isTemplateExpression(firstArg)) {
            addFinding(firstArg, {
              ruleId: 'SEC-002',
              severity: 'CRITICAL',
              confidence: 'HIGH',
              status: 'confirmed',
              explanation: `SQL query constructed using unparameterized template string interpolation (\`\${...}\`).`,
              remediation: `Use parameterized query placeholders ($1) with values array, or a safe tagged template literal (e.g. sql\`...\`).`,
            });
          }
        }
      }

      // -------------------------------------------------------------
      // RULE SEC-003: Unsafe Code Evaluation
      // -------------------------------------------------------------
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        // Direct eval(...)
        if (ts.isIdentifier(callee) && callee.text === 'eval') {
          addFinding(node, {
            ruleId: 'SEC-003',
            severity: 'CRITICAL',
            confidence: 'HIGH',
            status: 'confirmed',
            explanation: `Direct call to eval() allows execution of arbitrary code and bypasses type safety and sandbox isolation.`,
            remediation: `Replace eval() with safe deterministic parsing, JSON.parse(), or a typed recursive descent AST parser.`,
          });
        }
        // setTimeout("...", 100) or setInterval("...", 100)
        else if (
          ts.isIdentifier(callee) &&
          (callee.text === 'setTimeout' || callee.text === 'setInterval')
        ) {
          const firstArg = node.arguments[0];
          if (
            firstArg &&
            (ts.isStringLiteral(firstArg) || ts.isTemplateExpression(firstArg))
          ) {
            addFinding(node, {
              ruleId: 'SEC-003',
              severity: 'HIGH',
              confidence: 'HIGH',
              status: 'confirmed',
              explanation: `${callee.text}() called with string argument behaves like implicit eval().`,
              remediation: `Pass a callback function reference or arrow function () => { ... } instead of a string.`,
            });
          }
        }
      }
      // new Function(...)
      if (ts.isNewExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
          addFinding(node, {
            ruleId: 'SEC-003',
            severity: 'CRITICAL',
            confidence: 'HIGH',
            status: 'confirmed',
            explanation: `new Function() dynamically compiles and executes arbitrary code strings at runtime.`,
            remediation: `Avoid runtime code generation; implement logic using static modular functions.`,
          });
        }
      }

      // -------------------------------------------------------------
      // RULE SEC-004: Excessive Cyclomatic Complexity
      // -------------------------------------------------------------
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      ) {
        const complexity = calculateCyclomaticComplexity(node);
        if (complexity > 15) {
          let fnName = 'anonymous function';
          if (ts.isFunctionDeclaration(node) && node.name) {
            fnName = `function '${node.name.text}'`;
          } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
            fnName = `method '${node.name.text}'`;
          } else if (
            ts.isVariableDeclaration(node.parent) &&
            ts.isIdentifier(node.parent.name)
          ) {
            fnName = `function '${node.parent.name.text}'`;
          }

          addFinding(node, {
            ruleId: 'SEC-004',
            severity: 'MEDIUM',
            confidence: 'HIGH',
            status: 'confirmed',
            explanation: `Excessive cyclomatic complexity in ${fnName} (McCabe M = ${complexity}, threshold = 15). High complexity correlates with logic errors and difficulty in security auditing.`,
            remediation: `Decompose this function into smaller, single-responsibility sub-functions or simplify conditional branches.`,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const summary = {
      totalIssues: findings.length,
      critical: findings.filter((f) => f.severity === 'CRITICAL').length,
      high: findings.filter((f) => f.severity === 'HIGH').length,
      medium: findings.filter((f) => f.severity === 'MEDIUM').length,
      low: findings.filter((f) => f.severity === 'LOW').length,
      info: findings.filter((f) => f.severity === 'INFO').length,
    };

    return {
      filePath,
      findings,
      summary,
      securityNotice:
        'Notice: Static AST analysis detects syntactic anti-patterns and known structural risks. The absence of findings does not constitute proof that the code is free of security vulnerabilities, runtime flaws, or logic errors.',
      durationMs: Date.now() - startTime,
    };
  }
}

export const codeAuditorService = new CodeAuditorService();
