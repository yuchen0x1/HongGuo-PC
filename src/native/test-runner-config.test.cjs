const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('ordinary test runner skips explicit live playback and reports every executed platform check', () => {
  const calls = [], logs = [], directory = path.resolve(__dirname, '../../scripts');
  const source = fs.readFileSync(path.join(directory, 'test.cjs'), 'utf8');
  const fakeFs = { readdirSync: value => {
    if (value === directory) return ['check-playback-live.cjs', 'check-playback-telemetry.cjs', 'check-ui-theme.cjs'];
    return value.endsWith('src/native') || value.endsWith('src\\native') ? ['fixture.test.cjs'] : ['fixture.mjs'];
  } };
  vm.runInNewContext(source, { __dirname: directory,
    process: { execPath: 'isolated-node', env: {}, exitCode: undefined },
    console: { log: value => logs.push(value), error: value => logs.push(value) },
    require: name => name === 'node:fs' ? fakeFs : name === 'node:path' ? path
      : name === 'node:child_process' ? { spawnSync: (_exe, args) => { calls.push(Array.from(args)); return { status: 0 }; } }
      : name === 'electron' ? 'isolated-electron' : require(name),
  });
  assert(!calls.some(args => args.some(value => /check-playback-live\.cjs$/.test(value))));
  assert(calls.some(args => args.includes('scripts/check-windows-installer.cjs') && args.includes('--config')));
  assert(calls.some(args => args.includes('scripts/check-workflow-governance.cjs')));
  assert.equal(logs.at(-1), `npm test: unit tests and ${calls.length - 1} platform checks passed`);
});
