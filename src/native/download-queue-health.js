function isAutomaticRetry(task) {
  return task?.status === 'failed' && Number.isFinite(Number(task.retryAt)) && Number(task.retryAt) > 0;
}

function summarizeDownloadQueue({ tasks = [], queue = [], active = 0, maxConcurrent = 3, now = Date.now() } = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const counts = {
    pending: 0,
    downloading: 0,
    retrying: 0,
    failed: 0,
    stopped: 0,
    completed: 0,
  };
  let nextRetryAt = null;
  for (const task of list) {
    const status = String(task?.status || '');
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status]++;
    if (isAutomaticRetry(task)) {
      counts.retrying++;
      const retryAt = Number(task.retryAt);
      if (nextRetryAt === null || retryAt < nextRetryAt) nextRetryAt = retryAt;
    }
  }
  const queuedIds = new Set((Array.isArray(queue) ? queue : []).map(task => task?.id).filter(Boolean));
  const queued = [...queuedIds].length;
  const retryAfterMs = nextRetryAt === null ? null : Math.max(0, nextRetryAt - safeNow);
  return {
    active: Math.max(0, Number(active) || 0),
    queued,
    maxConcurrent: Math.max(1, Number(maxConcurrent) || 1),
    pending: counts.pending,
    downloading: counts.downloading,
    retrying: counts.retrying,
    failed: counts.failed,
    stopped: counts.stopped,
    completed: counts.completed,
    manualAction: counts.failed - counts.retrying + counts.stopped,
    nextRetryAt,
    retryAfterMs,
  };
}

module.exports = { isAutomaticRetry, summarizeDownloadQueue };
