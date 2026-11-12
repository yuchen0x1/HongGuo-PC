const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const { decryptInWorker } = require('../src/native/decrypt-worker.cjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hongguo-worker-'));
  try {
    const bytes = Buffer.from([0,0,0,8,109,111,111,118]); // empty valid moov, no encrypted samples
    const srcPath = path.join(dir, 'input.mp4'), dstPath = path.join(dir, 'out.mp4');
    await fs.writeFile(srcPath, bytes);
    const key = Buffer.alloc(16);
    let yielded = false;
    setImmediate(() => { yielded = true; });
    const result = await decryptInWorker({ buffer: bytes, key });
    assert.deepEqual(result, bytes); assert.ok(yielded, 'worker must yield the main event loop');
    await decryptInWorker({ srcPath, dstPath, key });
    assert.deepEqual(await fs.readFile(dstPath), bytes);
    assert.deepEqual(await fs.readFile(srcPath), bytes, 'source must remain unchanged');
    await assert.rejects(decryptInWorker({ buffer: Buffer.from('invalid'), key }), /moov|bounds|offset|MP4/i);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(decryptInWorker({ buffer: bytes, key }, {signal:controller.signal}), /取消/);
    const mid = new AbortController();
    const pending = decryptInWorker({srcPath, dstPath:path.join(dir,'cancelled.mp4'),key}, {signal:mid.signal});
    mid.abort();
    await assert.rejects(pending, /取消/);
    assert.equal(await fs.stat(path.join(dir,'cancelled.mp4')).then(() => true, () => false), false);

    // 伪造的表项计数不能变成 new Array(0xFFFFFFFF) 或数十亿次循环：必须在 box 长度内裁剪。
    const box = (type, payload) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(8 + payload.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, payload]);
    };
    const u32 = (...values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4)); return b; };
    const stsz = box('stsz', u32(0, 0, 0xFFFFFFFF));            // sample_size=0, sample_count=0xFFFFFFFF
    const stco = box('stco', u32(0, 0xFFFFFFFF));                // entry_count=0xFFFFFFFF
    const stsc = box('stsc', u32(0, 1, 1, 0xFFFFFFFF, 1));       // chunk 1..0xFFFFFFFF, 每块 0xFFFFFFFF 个样本
    const stbl = box('stbl', Buffer.concat([stsz, stco, stsc]));
    const malformed = box('moov', box('trak', box('mdia', box('minf', stbl))));
    const startedAt = Date.now();
    const clamped = await decryptInWorker({ buffer: malformed, key });
    assert.ok(Buffer.isBuffer(clamped), 'hostile sample counts must not abort the worker');
    assert.ok(Date.now() - startedAt < 5000, 'hostile sample counts must not hang the worker');

    // 极深嵌套必须是明确错误，而不是 RangeError 栈溢出。
    let nested = box('stbl', Buffer.alloc(0));
    for (let i = 0; i < 40; i++) nested = box('trak', nested);
    await assert.rejects(decryptInWorker({ buffer: box('moov', nested), key }), /嵌套|结构异常/);
    console.log('PASS decrypt worker: parity, event-loop yield, file integrity, error and cancellation');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
})().catch(e => {console.error('FAIL decrypt worker:', e.message); process.exitCode=1;});
