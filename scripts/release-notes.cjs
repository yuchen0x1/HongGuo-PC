// Public release bodies come from the user-facing history, never the release audit.
const fs = require('node:fs');
const path = require('node:path');

const historyFile = path.join(__dirname, '../docs/releases/release-notes.md');

function getReleaseNotes(tag, history = fs.readFileSync(historyFile, 'utf8')) {
  if (!/^v\d+\.\d+$/.test(tag)) throw new Error('Expected a release tag such as v6.9');
  const version = tag.slice(1);
  const sections = history.split(/^## /m).slice(1)
    .map(section => /^(\d+\.\d+) · \d{4}-\d{2}-\d{2}\r?\n([\s\S]*)$/.exec(section))
    .filter(section => section && section[1] === version);
  if (sections.length !== 1) throw new Error(`Expected exactly one release notes section for ${tag}`);
  const lines = sections[0][2].trim().split(/\r?\n/).filter(line => line.trim());
  if (!lines.length || lines.some(line => !/^- \S/.test(line))) {
    throw new Error(`${tag} release notes must contain only a list of user-facing changes`);
  }
  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  try {
    const notes = getReleaseNotes(process.argv[2]);
    if (process.argv[3]) fs.writeFileSync(process.argv[3], notes, 'utf8');
    else process.stdout.write(notes);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { getReleaseNotes };
