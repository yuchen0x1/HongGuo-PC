const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const dir = path.join(__dirname, '..', '.github', 'workflows');
const files = fs.readdirSync(dir).filter(name => /\.ya?ml$/.test(name)).sort();
const load = name => {
  const doc = yaml.load(fs.readFileSync(path.join(dir, name), 'utf8'));
  return { ...doc, on: doc.on ?? doc[true] };
};
const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const checks = [];
const test = (name, run) => checks.push([name, run]);

test('every workflow declares explicit minimal permissions', () => {
  for (const name of files) {
    const doc = load(name);
    assert.ok(doc.permissions !== undefined, `${name} must declare permissions`);
    assert.notEqual(doc.permissions, 'write-all', `${name} must not use write-all`);
    for (const [job, config] of Object.entries(doc.jobs || {})) {
      assert.notEqual(config.permissions, 'write-all', `${name}:${job} must not use write-all`);
    }
  }
});

test('third-party actions are pinned to full commit SHAs', () => {
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
      if (!match || match[1].startsWith('./')) continue;
      const [action, ref] = match[1].split('@');
      assert.ok(ref, `${name}: ${action} has no ref`);
      assert.match(ref, /^[0-9a-f]{40}$/, `${name}: ${action}@${ref} must be pinned to a 40-character commit SHA`);
    }
  }
});

test('artifact uploads retain named ZIP archives for existing download consumers', () => {
  for (const name of files) {
    for (const [job, config] of Object.entries(load(name).jobs || {})) {
      for (const step of config.steps || []) {
        if (!step.uses?.startsWith('actions/upload-artifact@')) continue;
        assert.equal(step.with?.archive, true,
          `${name}:${job} must keep ZIP archives; raw uploads ignore artifact names and cannot be read by download-artifact v4`);
      }
    }
  }
});

test('pull request branches are not built twice by push and pull_request', () => {
  for (const name of files) {
    const on = load(name).on || {};
    if (!has(on, 'push') || !has(on, 'pull_request')) continue;
    const push = on.push === null ? {} : on.push;
    const branches = Array.isArray(push.branches) ? push.branches : null;
    const tags = Array.isArray(push.tags) ? push.tags : null;
    const scopedToDefault = Boolean(branches && branches.includes('main'));
    const tagsOnly = Boolean(tags && !branches);
    assert.ok(scopedToDefault || tagsOnly,
      `${name} triggers on every push and on pull_request; PR commits would run twice`);
  }
});

test('long release workflows serialize instead of cancelling each other', () => {
  for (const name of ['windows.yml', 'publish-windows-release.yml', 'verify-live-update.yml']) {
    const doc = load(name);
    assert.ok(doc.concurrency, `${name} needs a concurrency group`);
    assert.equal(doc.concurrency['cancel-in-progress'], false, `${name} must not cancel an in-flight run`);
  }
});

test('release publication stays bound to the default branch and a protected environment', () => {
  const publish = load('publish-windows-release.yml');
  const job = publish.jobs.publish;
  assert.deepEqual(publish.permissions, {}, 'workflow-level permissions stay empty; the job grants only what it needs');
  assert.equal(job.environment, 'windows-release', 'publication must run in the windows-release environment');
  assert.match(job.if, /default_branch/, 'publication must verify it runs from the default branch');
  assert.equal(job.permissions.contents, 'write');
  assert.equal(job.permissions.actions, 'read');
  for (const input of ['tag', 'candidate_run_id', 'test_run_id', 'expected_commit']) {
    assert.ok(publish.on.workflow_dispatch.inputs[input]?.required, `${input} must be a required dispatch input`);
  }
});

test('the source test suite runs for the tags that publication checks', () => {
  const on = load('test.yml').on || {};
  assert.ok(has(on, 'pull_request'), 'Test must still run for pull requests');
  const push = on.push === null ? {} : on.push || {};
  assert.ok(Array.isArray(push.tags) && push.tags.includes('v*'),
    'Test must run for v* tags so a candidate can cite a green source run');
  assert.ok(Array.isArray(push.branches) && push.branches.includes('main'), 'Test must run on main');
});

test('scheduled maintenance is bounded and read-only where possible', () => {
  const probe = load('playback-probe.yml');
  // 探针需要自己维护告警 issue，除此之外只读仓库。
  assert.deepEqual(probe.permissions, { contents: 'read', issues: 'write' },
    'the playback probe may only read the repository and manage its own alert issues');
  assert.ok(probe.on.schedule?.length, 'the playback probe must be scheduled');
  assert.equal(probe.concurrency['cancel-in-progress'], false);
  const codeql = load('codeql.yml');
  assert.deepEqual(codeql.permissions, { contents: 'read' });
  assert.equal(codeql.jobs.javascript.permissions['security-events'], 'write');
  const sync = load('sync-release-readme.yml');
  assert.deepEqual(sync.permissions, { contents: 'write' });
  assert.equal(sync.concurrency['cancel-in-progress'], false,
    'concurrent README syncs would race on the same file');
});

let failed = 0;
for (const [name, run] of checks) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`${checks.length - failed}/${checks.length} workflow governance checks passed`);
process.exitCode = failed ? 1 : 0;
