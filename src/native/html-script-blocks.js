// Extract inert script text for JSON parsing, never for HTML sanitization or execution.
function* readScriptBlocks(value) {
  const html = String(value);
  const opening = /<script\b/gi;
  const closing = /<\/script\s*>/gi;
  let match;
  while ((match = opening.exec(html))) {
    const contentStart = html.indexOf('>', opening.lastIndex);
    if (contentStart < 0) return;
    closing.lastIndex = contentStart + 1;
    const end = closing.exec(html);
    // Later openings cannot have a closing tag if this suffix has none.
    if (!end) return;
    yield { attributes: html.slice(opening.lastIndex, contentStart), text: html.slice(contentStart + 1, end.index) };
    opening.lastIndex = closing.lastIndex;
  }
}

module.exports = { readScriptBlocks };
