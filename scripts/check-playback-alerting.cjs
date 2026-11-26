// 播放探针告警脚本的离线检查。
// workflow 里的 github-script 只在故障时执行，健康时永远不会暴露它的 bug，
// 所以这里把脚本抽出来、用假 github 对象跑各条分支（开 issue / 去重 / 恢复关闭 / 崩溃）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const workflow = path.join(root, '.github', 'workflows', 'playback-probe.yml');
const doc = yaml.load(fs.readFileSync(workflow, 'utf8'));
const step = doc.jobs.probe.steps.find(item => item.name?.startsWith('Report the outcome'));
assert.ok(step?.with?.script, 'the probe workflow must keep a reporting step');

// 脚本按相对路径读取报告，因此在独立临时目录里运行，避免与并行检查抢同一文件。
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'playback-alert-'));
const previous = process.cwd();
process.chdir(sandbox);
const healthy = { schema: 1, version: '6.41.0', scope: 'light', elapsedMs: 10000,
  layers: [{ layer: 'catalog', status: 'ok' }, { layer: 'episodes', status: 'ok' },
    { layer: 'source', status: 'ok' }, { layer: 'media', status: 'ok' }],
  samples: [], routes: [{ source: 'app', status: 'address-found', samples: 6 }],
  failures: [], fingerprint: '', healthy: true };
const broken = { schema: 1, version: '6.41.0', scope: 'light', elapsedMs: 9000,
  layers: [{ layer: 'episodes', status: 'failed', code: 'INVALID_RESPONSE', checkedSeries: 2 }],
  samples: [], routes: [], failures: [{ layer: 'episodes', code: 'INVALID_RESPONSE' }],
  fingerprint: 'abc123def456', healthy: false };

function fakeGithub(issues, comments = []) {
  const log = [];
  return { log,
    rest: { issues: {
      listForRepo: async () => ({ data: issues }),
      listComments: async () => ({ data: comments }),
      createComment: async args => { log.push(['comment', args.issue_number, args.body]); return { data: {} }; },
      update: async args => { log.push(['update', args.issue_number, args.state]); return { data: {} }; },
      create: async args => { log.push(['create', args.title, args.body]); return { data: { number: 42 } }; },
    } },
    paginate: async (fn, args) => (await fn(args)).data };
}

async function run(report, issues, comments) {
  fs.writeFileSync(path.join(sandbox, 'playback-health.json'),
    typeof report === 'string' ? report : JSON.stringify(report));
  const github = fakeGithub(issues, comments);
  const context = { repo: { owner: 'o', repo: 'r' }, serverUrl: 'https://github.com', runId: 123 };
  const fn = new Function('github', 'context', 'require', 'console', `return (async () => {${step.with.script}})()`);
  await fn(github, context, require, { log: () => {}, error: () => {} });
  return github.log;
}

const tracked = (title, number = 7) =>
  ({ number, title, pull_request: undefined, created_at: '2026-11-27T00:00:00Z' });
const FAULT_TITLE = '[playback-health:abc123def456] 播放健康探针失败：episodes/INVALID_RESPONSE';

const checks = [];
const test = (name, run) => checks.push([name, run]);

test('a healthy run closes tracked issues and opens nothing', async () => {
  const log = await run(healthy, [tracked(FAULT_TITLE)]);
  assert.equal(log.filter(item => item[0] === 'create').length, 0, 'must not open an issue when healthy');
  assert.deepEqual(log.filter(item => item[0] === 'update'), [['update', 7, 'closed']],
    'recovery must close the tracked issue');
});

test('a new fault opens one issue naming the layer and code', async () => {
  const log = await run(broken, []);
  const created = log.filter(item => item[0] === 'create');
  assert.equal(created.length, 1, 'must open exactly one issue');
  assert.match(created[0][1], /\[playback-health:abc123def456\]/, 'title must carry the fingerprint marker');
  assert.match(created[0][1], /episodes\/INVALID_RESPONSE/, 'title must name the failing layer and code');
  assert.match(created[0][2], /episodes: INVALID_RESPONSE/, 'body must list the failure');
  assert.ok(!/\.mp4|media\.example|secret-path/.test(created[0][2]), 'body must not carry media addresses');
});

test('the same fingerprint dedupes to the existing issue', async () => {
  const log = await run(broken, [tracked(FAULT_TITLE)], []);
  assert.equal(log.filter(item => item[0] === 'create').length, 0, 'must not open a second issue');
  assert.equal(log.filter(item => item[0] === 'comment').length, 1, 'must comment on the existing issue');
});

test('a same-day repeat does not comment again', async () => {
  const today = new Date().toISOString();
  const log = await run(broken, [tracked(FAULT_TITLE)], [{ body: 'older', created_at: today }]);
  assert.equal(log.filter(item => item[0] === 'comment').length, 0, 'one comment per day is enough');
});

test('a crashed probe still raises an alert', async () => {
  const log = await run('<html>not json</html>', []);
  const created = log.filter(item => item[0] === 'create');
  assert.equal(created.length, 1, 'a missing report must not stay silent');
  assert.match(created[0][1], /probe\/PROBE_CRASHED/, 'the crash must be attributed to the probe');
});

(async () => {
  let failed = 0;
  try {
    for (const [name, check] of checks) {
      try { await check(); console.log(`PASS ${name}`); }
      catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
    }
  } finally {
    process.chdir(previous);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
  console.log(`${checks.length - failed}/${checks.length} playback alerting checks passed`);
  process.exitCode = failed ? 1 : 0;
})();
