const RENDERER_EVENTS = new Set(['media-state', 'playback-success', 'failure', 'recovery', 'cancelled']);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validRecoveryCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;

function createPlaybackStateReporter({ sessions, diagnostics }) {
  let current = null;
  const usedForeground = new WeakSet();
  const find = value => {
    if (!validId(value?.streamId) || !validId(value?.requestId)) return null;
    const session = sessions.get(value.streamId);
    return session?.requestId === value.requestId ? session : null;
  };
  const matches = value => current?.streamId === value.streamId && current.requestId === value.requestId;

  function begin(value = {}) {
    const session = find(value);
    if (!session || value.prefetch === true) return false;
    current = { streamId: value.streamId, requestId: value.requestId, successReported: false };
    usedForeground.add(session);
    diagnostics?.setForeground?.(value.requestId);
    diagnostics?.record({ requestId: value.requestId, event: 'media-state', stage: 'source', mediaStatus: 'resolving', decoderStatus: 'pending',
      recoveryCount: validRecoveryCount(value.recoveryCount) ? value.recoveryCount : 0 });
    return true;
  }

  function report(value = {}) {
    if (!value || typeof value !== 'object' || !RENDERER_EVENTS.has(value.event)) return false;
    const session = find(value);
    if (!session || value.recoveryCount !== undefined && !validRecoveryCount(value.recoveryCount)) return false;
    if (!matches(value)) {
      // A completed prefetch is promoted only by the player's explicit handover.
      if (value.activate !== true || value.event !== 'media-state' || value.stage !== 'media'
        || value.mediaStatus !== 'loading' || usedForeground.has(session)) return false;
      if (!begin(value)) return false;
    }
    if (value.event === 'playback-success') {
      if (current.successReported) return false;
      current.successReported = true;
    }
    const { event, stage, mediaStatus, decoderStatus, faultCode, recoveryCount } = value;
    diagnostics?.record({ requestId: value.requestId, event, stage, mediaStatus, decoderStatus, faultCode,
      ...(validRecoveryCount(recoveryCount) ? { recoveryCount } : {}) });
    return true;
  }

  return { begin, report };
}

module.exports = { createPlaybackStateReporter };
