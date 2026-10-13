/**
 * Automated Verification Suite for Milestone 2: Code & Security Auditor Specialist
 * Verifies:
 * 1. SEC-001: Hardcoded Secrets (Positive & Negative fixtures, Shannon Entropy, Allowlist)
 * 2. SEC-002: SQL Injection (Concatenation, Unsafe Template, Parameterized Safe)
 * 3. SEC-003: Unsafe Evaluation (eval, new Function, string setTimeout, arrow function safe)
 * 4. SEC-004: Cyclomatic Complexity (M > 15 flagged, simple function safe)
 * 5. Finding Schema & Location accuracy (1-based line & column coordinates)
 * 6. Swarm Integration & Budget Claim
 */

import { codeAuditorService } from '../server/services/codeAuditorService.ts';
import { specialistSwarmService } from '../server/services/specialistSwarmService.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runMilestone2Tests() {
  console.log('\n======================================================');
  console.log('RUNNING MILESTONE 2: CODE AUDITOR TEST SUITE');
  console.log('======================================================\n');

  // ----------------------------------------------------------------
  // Test 1: SEC-001 Hardcoded Secrets
  // ----------------------------------------------------------------
  console.log('Test 1: SEC-001 Hardcoded Secrets');
  const vulnerableSecretsCode = `
    const AWS_KEY = "AKIA1234567890ABCDEF";
    const STRIPE_SECRET = "sk_live_123456789012345678901234";
    const RANDOM_TOKEN = "aK9qL2mN5pQ8vW1xY4zB6cD7eF3g";
  `;
  const report1 = codeAuditorService.auditSourceCode(vulnerableSecretsCode, 'authService.ts');
  const sec001Findings = report1.findings.filter((f) => f.ruleId === 'SEC-001');
  assert(sec001Findings.length >= 2, `Detected at least 2 hardcoded secret patterns (got ${sec001Findings.length})`);
  assert(sec001Findings.some((f) => f.severity === 'CRITICAL'), 'AWS/Stripe key flagged with CRITICAL severity');
  assert(sec001Findings.every((f) => f.line > 0 && f.column > 0), 'Source locations contain valid line & column');

  // Allowlist & Test Path Exemption
  const testPathReport = codeAuditorService.auditSourceCode(
    'const DUMMY_AWS = "AKIAIOSFODNN7EXAMPLE";',
    'src/__tests__/auth.test.ts'
  );
  assert(testPathReport.findings.length === 0, 'Known dummy keys in test path are exempt');

  // ----------------------------------------------------------------
  // Test 2: SEC-002 SQL Injection Vulnerability
  // ----------------------------------------------------------------
  console.log('\nTest 2: SEC-002 SQL Injection Detection');
  const vulnerableSqlCode = `
    async function getUser(db: any, id: string, name: string) {
      // Vulnerable concat
      const r1 = await db.query("SELECT * FROM users WHERE id = " + id);
      // Vulnerable template literal
      const r2 = await client.query(\`SELECT * FROM users WHERE name = '\${name}'\`);
      // Safe parameterized query
      const r3 = await db.query("SELECT * FROM users WHERE id = $1 AND name = $2", [id, name]);
      return { r1, r2, r3 };
    }
  `;
  const report2 = codeAuditorService.auditSourceCode(vulnerableSqlCode, 'userRepo.ts');
  const sec002Findings = report2.findings.filter((f) => f.ruleId === 'SEC-002');
  assert(sec002Findings.length === 2, `Detected exactly 2 SQL injection anti-patterns (got ${sec002Findings.length})`);
  assert(sec002Findings[0].explanation.includes('string concatenation'), 'Flagged string concatenation (+) injection');
  assert(sec002Findings[1].explanation.includes('template string interpolation'), 'Flagged template string (${...}) injection');

  // Safe Parameterized Query Verification
  const safeSqlCode = `
    const user = await pool.query("SELECT * FROM accounts WHERE id = $1", [userId]);
  `;
  const safeSqlReport = codeAuditorService.auditSourceCode(safeSqlCode, 'safeRepo.ts');
  assert(safeSqlReport.findings.filter((f) => f.ruleId === 'SEC-002').length === 0, 'Safe parameterized query yielded 0 findings');

  // ----------------------------------------------------------------
  // Test 3: SEC-003 Unsafe Code Evaluation
  // ----------------------------------------------------------------
  console.log('\nTest 3: SEC-003 Unsafe Code Evaluation');
  const vulnerableEvalCode = `
    function runDynamic(code: string, expr: string) {
      eval(code);
      const fn = new Function("a", "b", "return a + b");
      setTimeout("doSomething()", 500);
      setTimeout(() => doSafeSomething(), 500); // Safe arrow function
    }
  `;
  const report3 = codeAuditorService.auditSourceCode(vulnerableEvalCode, 'executor.ts');
  const sec003Findings = report3.findings.filter((f) => f.ruleId === 'SEC-003');
  assert(sec003Findings.length === 3, `Detected 3 unsafe evaluation patterns (eval, new Function, string setTimeout)`);
  assert(sec003Findings.some((f) => f.snippet.includes('eval')), 'Flagged direct eval() call');
  assert(sec003Findings.some((f) => f.snippet.includes('new Function')), 'Flagged new Function() instantiation');
  assert(sec003Findings.some((f) => f.snippet.includes('setTimeout')), 'Flagged string-based setTimeout()');

  // ----------------------------------------------------------------
  // Test 4: SEC-004 Excessive Cyclomatic Complexity (M > 15)
  // ----------------------------------------------------------------
  console.log('\nTest 4: SEC-004 Cyclomatic Complexity (M > 15)');
  const highComplexityCode = `
    function processTransaction(t: any) {
      if (t.a) {
        if (t.b && t.c) {
          while (t.d) {
            if (t.e || t.f) {
              for (let i = 0; i < 10; i++) {
                if (t.g) return 1;
                else if (t.h) return 2;
                else if (t.i) return 3;
                else if (t.j ?? t.k) return 4;
              }
            }
          }
        }
      }
      switch (t.type) {
        case 1: return 10;
        case 2: return 20;
        case 3: return 30;
        case 4: return 40;
        default: return 0;
      }
    }

    function simpleFunction(x: number) {
      return x > 0 ? x * 2 : 0;
    }
  `;
  const report4 = codeAuditorService.auditSourceCode(highComplexityCode, 'transactionProcessor.ts');
  const sec004Findings = report4.findings.filter((f) => f.ruleId === 'SEC-004');
  assert(sec004Findings.length === 1, `Flagged exactly 1 high-complexity function (got ${sec004Findings.length})`);
  assert(sec004Findings[0].explanation.includes("function 'processTransaction'"), 'Identified function name processTransaction');
  assert(sec004Findings[0].explanation.includes('McCabe M ='), 'Calculated explicit McCabe complexity score');

  // ----------------------------------------------------------------
  // Test 5: Schema & Security Notice Verification
  // ----------------------------------------------------------------
  console.log('\nTest 5: Report Schema & Security Notice');
  assert(typeof report4.durationMs === 'number', 'Report includes durationMs');
  assert(report4.summary.totalIssues === 1, 'Summary matches findings count');
  assert(
    report4.securityNotice.includes('Static AST analysis detects syntactic anti-patterns'),
    'Security Notice correctly attached'
  );

  // ----------------------------------------------------------------
  // Test 6: Swarm Orchestrator Integration & Tool Budget Claim
  // ----------------------------------------------------------------
  console.log('\nTest 6: Swarm Orchestrator CodeAuditor Dispatch');
  const swarmSession = await specialistSwarmService.executeSwarmTurn({
    userPrompt: 'Please audit this code for security vulnerabilities: ```ts function run(db: any, id: string) { return db.query("SELECT * FROM t WHERE id = " + id); } ```',
    callbacks: {
      onSpecialistStart: (d) => {
        if (d.specialist === 'CodeAuditor') {
          console.log('    [Event] CodeAuditor started:', d.role);
        }
      },
      onToolResult: (d) => {
        if (d.specialist === 'CodeAuditor') {
          console.log('    [Event] Tool result:', d.outputSummary);
        }
      },
    },
  });

  assert(
    swarmSession.specialistsInvolved.includes('CodeAuditor'),
    'Swarm orchestrator routed task to CodeAuditor specialist'
  );
  const auditorTrace = swarmSession.traces.find((t) => t.specialist === 'CodeAuditor');
  assert(Boolean(auditorTrace), 'Auditor trace captured in session');
  assert(auditorTrace?.tools[0].toolName === 'auditCode', 'auditCode tool executed and traced');
  assert((swarmSession.budgetUsed || 0) >= 1, `Tool budget claimed by auditor (budget used: ${swarmSession.budgetUsed})`);

  console.log('\n======================================================');
  console.log('ALL MILESTONE 2 TESTS PASSED SUCCESSFULLY! (6/6)');
  console.log('======================================================\n');
  process.exit(0);
}

runMilestone2Tests().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
