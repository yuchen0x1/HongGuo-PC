const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { stripMarkupText } = require('./plain-text');
const { readScriptBlocks } = require('./html-script-blocks');
const { cleanTitle } = require('./hongguo-app-search');
const { parsePassportProfile } = require('./account-session');

test('display normalization preserves the previous tag and unmatched-suffix contract', () => {
  const samples = ['', 'plain > text', '<>', 'before<tag>after', 'a<<tag>middle</tag>tail<',
    '<one><two>text</two></one>', 'line<not\na\nparser>next', 'before<unfinished<<suffix',
    '<script<script>alert(1)</script>>', '&lt;b&gt;encoded&lt;/b&gt;'];
  for (const sample of samples) for (const replacement of ['', ' ']) {
    assert.equal(stripMarkupText(sample, replacement), sample.replace(/<[^>]*>/g, replacement));
  }
});

test('account and App search retain their existing entity decoding after display normalization', () => {
  const input = ' <b>title</b> &amp;lt;i&amp;gt; &quot;quoted&quot; &#39;single&#39; trailing< ';
  const expected = 'title <i> "quoted" \'single\' trailing<';
  assert.equal(cleanTitle(input), expected);
  const profile = parsePassportProfile({ message: 'success', data: { user_id_str: '123', name: input } });
  assert.equal(profile.nickname, expected);
});

test('JSON-LD extraction preserves script attributes, nesting and closing-tag semantics', () => {
  const samples = ['', '<scripted>ignored</script>', '<script>one</script><SCRIPT TYPE="application/ld+json">two</SCRIPT >',
    '<script type="application/ld+json">{"label":"<script>"}</script>',
    '<script a<b>one</script>', '<script>unfinished<script>still unfinished', '<script unfinished<script'];
  for (const sample of samples) {
    const expected = [...sample.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
      .map(match => ({ attributes: match[1], text: match[2] }));
    assert.deepEqual([...readScriptBlocks(sample)], expected);
  }
});

test('multi-megabyte unclosed tags cannot monopolize the main-process text parsers', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { stripMarkupText } = require('./plain-text');
    const { readScriptBlocks } = require('./html-script-blocks');
    const { cleanTitle } = require('./hongguo-app-search');
    const { parsePassportProfile } = require('./account-session');
    const unclosed = '<'.repeat(2 * 1024 * 1024);
    assert.equal(stripMarkupText(unclosed), unclosed);
    assert.equal(stripMarkupText('before<' + unclosed + '>after' + unclosed), 'beforeafter' + unclosed);
    assert.equal(cleanTitle(unclosed), unclosed);
    assert.equal(parsePassportProfile({ message: 'success', data: { user_id_str: '123', name: unclosed } }).nickname, unclosed);
    assert.deepEqual([...readScriptBlocks('<script>'.repeat(256 * 1024))], []);
    assert.deepEqual([...readScriptBlocks('<script'.repeat(256 * 1024))], []);
    process.stdout.write('passed');
  `], { cwd: __dirname, encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(child.error, undefined, 'Long malformed text must finish within its isolated process budget');
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'passed');
});
