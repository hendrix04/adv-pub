// Control-flow check only; application acceptance still requires live testing.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'kiro-execute.js'), 'utf8')
  .replace('export const meta', 'const meta');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('args', 'agent', 'log', source);

(async () => {
  for (const scenario of ['pass', 'repair', 'exhausted', 'blocked', 'backlog', 'other-error']) {
    let reviews = 0;
    const calls = [];
    const backlog = scenario === 'backlog';
    const args = {
      taskKeys: backlog ? ['A', 'B'] : ['A'],
      packetPaths: backlog ? ['a', 'b'] : ['a'],
      ledgerPath: 'ledger',
    };
    const invoke = () => run(args, async (_prompt, options) => {
      calls.push(options);
      if (options.phase !== 'Review') return { verdict: 'PASS', summary: 'Implemented', evidence: 'mock' };
      if (scenario === 'other-error') throw Error('Workspace broken');
      reviews++;
      return {
        verdict: scenario === 'blocked' ? 'BLOCKED'
          : scenario === 'exhausted' || (scenario === 'repair' && reviews === 1) ? 'FAIL' : 'PASS',
        summary: 'Review', evidence: 'mock',
      };
    }, () => {});
    if (scenario === 'other-error') {
      await assert.rejects(invoke, /Workspace broken/);
      assert.equal(calls.length, 2); // Provider errors propagate.
    } else {
      const result = await invoke();
      assert.equal(result.status, scenario === 'blocked' ? 'BLOCKED' : scenario === 'exhausted' ? 'FAIL' : 'PASS');
      if (scenario === 'exhausted') assert.equal(reviews, 4);
      if (scenario === 'repair') assert.equal(reviews, 2);
      if (backlog) assert.equal(calls.length, 4);
      assert(calls.every(call => call.provider === 'codex'));
      assert(calls.filter(call => call.phase === 'Review').every(call => call.model === 'gpt-6.1-sol'));
      assert(calls.filter(call => call.phase !== 'Review').every(call => call.model === 'gpt-6-luna'));
      assert(calls.filter(call => call.phase === 'Review').every(call => call.reasoningLevel === 'xhigh'));
      assert(calls.filter(call => call.phase !== 'Review').every(call => call.reasoningLevel === 'xhigh'));
    }
    console.log(`${scenario}: PASS`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
