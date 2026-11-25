// Cookie reads can finish after the sandbox window closes. Check lifetime before verification.
function createWebLoginObserver({ readCookies, complete, cancel, onSignedIn, onError = () => {} }) {
  let closed = false, running = false, dirty = false;
  async function inspect() {
    if (closed) return;
    if (running) { dirty = true; return; }
    running = true;
    try {
      const cookies = (await readCookies()).filter(item => {
        const domain = String(item.domain || 'hongguoduanju.com').replace(/^\./, '').toLowerCase();
        return (domain === 'hongguoduanju.com' || domain.endsWith('.hongguoduanju.com'))
          && typeof item.name === 'string' && /^[!#$%&'*+.^_`|~\w-]+$/.test(item.name)
          && typeof item.value === 'string' && !/[;\r\n\0]/.test(item.value)
          && (!Number.isFinite(item.expirationDate) || item.expirationDate <= 0 || item.expirationDate * 1000 > Date.now());
      });
      if (closed || !cookies.some(item => ['sessionid', 'sessionid_ss'].includes(item.name) && item.value)) return;
      const result = await complete(cookies.map(item => `${item.name}=${item.value}`).join('; '), { cookies });
      if (!closed && result.status === 'signed-in') { closed = true; onSignedIn(); }
    } catch (error) { if (!closed) onError(error); }
    finally {
      running = false;
      if (dirty && !closed) { dirty = false; void inspect(); }
    }
  }
  return { inspect, close() { if (closed) return; closed = true; cancel(); } };
}
module.exports = { createWebLoginObserver };
