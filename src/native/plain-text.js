// Display-text normalization only; callers must still escape at HTML/XML sinks.
function stripMarkupText(value, replacement = '') {
  const text = String(value);
  const pieces = [];
  let cursor = 0;
  while (true) {
    const start = text.indexOf('<', cursor);
    if (start < 0) break;
    const end = text.indexOf('>', start + 1);
    // Preserve an unmatched suffix without rescanning every remaining '<'.
    if (end < 0) break;
    pieces.push(text.slice(cursor, start), replacement);
    cursor = end + 1;
  }
  pieces.push(text.slice(cursor));
  return pieces.join('');
}

module.exports = { stripMarkupText };
