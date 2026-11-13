// Read-only upload guard. Reports names and categories, never matching credential values.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let files;
try { files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); }
catch (_) { console.log('NOT APPLICABLE repository upload guard: no Git index'); process.exit(0); }
const generatedRoot = /^(?:node_modules|dist(?:-[^/]+)?|verification|outputs|\.cache|\.zcode|\.workbuddy|docs\/superpowers|\.local|\.tokensave|\.planning|data|sessions|logs|downloads|backups|rollback|media|NVIDIA Corporation)\//i;
const privateFile = /(?:^|\/)(?:\.env(?:\.[^/]*)?|data\.json|danmaku-client\.json|\.updaterId|update-info\.json|[^/]+\.(?:pem|pfx|p12|key|db|sqlite|log|tmp|bak|backup))$/i;
const localNote = /^(?:PROJECT_AUDIT_REPORT\.md|\d{4}-\d{2}-\d{2}\.md|\.audit-[^/]*)$/i;
const credentials = [
  ['GitHub credential', /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{25,})\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['OpenAI credential', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
];
const findings = [];
let checked = 0;
for (const file of files) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) continue; // A pending tracked deletion is absent from the next tree.
  checked++;
  if (generatedRoot.test(file)) findings.push(`${file}: generated/local state must not be tracked`);
  if (privateFile.test(file)) findings.push(`${file}: private/runtime file must not be tracked`);
  if (localNote.test(file)) findings.push(`${file}: local work record must not be tracked`);
  if (/\.(?:png|jpe?g|ico|gz|zip)$/i.test(file)) continue;
  const text = fs.readFileSync(target, 'utf8');
  for (const [name, pattern] of credentials) if (pattern.test(text)) findings.push(`${file}: ${name}`);
}
if (findings.length) { console.error('FAIL repository upload guard\n' + findings.join('\n')); process.exitCode = 1; }
else console.log(`PASS repository upload guard: ${checked} tracked files; no forbidden artifacts or recognized credentials`);
