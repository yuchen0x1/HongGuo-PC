// SPDX-License-Identifier: GPL-3.0-only
// ttEncrypt and registration fields adapted from tsukiyo-zero/hongguoTV,
// commit 388931852ddc614db8b00775a3dc54c5ede6307f,
// kotlin-tv/core/src/main/kotlin/com/hongguotv/core/DeviceRegister.kt
// (itself adapted from charlie901208/HGTV feat/phone-login, GPL-3.0-only).
// Changes: fixed anonymous phone profile; process-only identity; no cookies or tokens.
const crypto = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { DEVICE_REGISTRATION, getPlaybackProfile } = require('./playback-profiles');

const REGISTER_URL = DEVICE_REGISTRATION.endpoint;
const KDF_SALT = Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58', 'hex');
let registration;
let refreshAfter = 0;
let retryAfter = 0;

function responseId(response, name) {
    const preferred = response?.[`${name}_str`];
    const value = preferred === undefined || preferred === null || preferred === '' ? response?.[name] : preferred;
    if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : '';
    return typeof value === 'string' && /^\d{1,30}$/.test(value) && /[1-9]/.test(value) ? value : '';
}

function registrationSignal(parent, timeout) {
    if (!parent) return { signal: AbortSignal.timeout(timeout), dispose() {} };
    const controller = new AbortController();
    const timeoutReason = () => Object.assign(new Error('App 片源请求超时'), { name: 'TimeoutError' });
    const abort = () => controller.abort(parent.reason?.name === 'TimeoutError' ? timeoutReason() : parent.reason);
    let timer;
    if (parent.aborted) abort();
    else {
        parent.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => controller.abort(timeoutReason()), timeout);
        timer.unref?.();
    }
    return { signal: controller.signal, dispose() {
        clearTimeout(timer);
        parent.removeEventListener('abort', abort);
    } };
}

async function registerPlaybackDevice(requestJson, options = {}) {
    const timeout = Math.max(1, Math.min(getPlaybackProfile().timeout.registrationMs, Number(options.timeoutMs) || Infinity));
    const request = registrationSignal(options?.signal, timeout);
    try {
            if (request.signal.aborted) throw Object.assign(new Error('Cancelled registration'), { code: 'ERR_CANCELED' });
            const now = Date.now();
            const cdid = crypto.randomUUID();
            const header = {
                ...DEVICE_REGISTRATION.profile, cdid, openudid: crypto.randomBytes(8).toString('hex'),
                clientudid: crypto.randomUUID(),
                req_id: crypto.randomUUID(), device_platform: 'android',
                apk_first_install_time: now,
            };
            const compressed = gzipSync(Buffer.from(JSON.stringify({ magic_tag: 'ss_app_log', header, _gen_time: now })));
            const random = crypto.randomBytes(32);
            const derived = crypto.createHash('sha512').update(Buffer.concat([
                crypto.createHash('sha512').update(random).digest(), KDF_SALT,
            ])).digest();
            const cipher = crypto.createCipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32));
            const plaintext = Buffer.concat([crypto.createHash('sha512').update(compressed).digest(), compressed]);
            const data = Buffer.concat([Buffer.from('746305100000', 'hex'), random, cipher.update(plaintext), cipher.final()]);
            const response = await requestJson(REGISTER_URL, {
                method: 'POST',
                headers: {
                    ...DEVICE_REGISTRATION.headers, 'x-ss-req-ticket': String(now),
                    'x-ss-stub': crypto.createHash('md5').update(data).digest('hex').toUpperCase(),
                },
                data,
            }, Date.now() + timeout, request.signal);
            const device_id = responseId(response, 'device_id');
            const iid = responseId(response, 'install_id');
            if (Number(response?.code ?? response?.Code ?? 0) !== 0) throw Object.assign(new Error('Registration rejected'), { code: 'BUSINESS_REJECTED' });
            if (!device_id || !iid) throw Object.assign(new Error('Invalid registration'), { code: 'INVALID_RESPONSE' });
        return Object.freeze({ device_id, iid, cdid });
    } catch (error) {
        if (options?.signal?.aborted) {
            const timeout = options.signal.reason?.name === 'TimeoutError';
            throw Object.assign(new Error(timeout ? 'App 片源请求超时' : '已取消 App 片源请求'), {
                code: timeout ? 'ETIMEDOUT' : 'ERR_CANCELED',
            });
        }
        const status = Number(error?.status);
        const registrationFailure = Number.isInteger(status) && status >= 300 && status <= 599 ? `HTTP_${status}`
            : ['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) ? 'TIMEOUT'
            : ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ERR_NETWORK', 'ERR_CANCELED'].includes(error?.code) ? 'NETWORK_ERROR'
            : ['EMPTY_RESPONSE', 'INVALID_RESPONSE', 'BUSINESS_REJECTED', 'SECURITY_BLOCKED'].includes(error?.code) ? error.code : 'UNKNOWN';
        throw Object.assign(new Error('匿名播放设备注册失败，请检查网络，10 秒后重试'), {
            code: 'DEVICE_REGISTRATION_FAILED', registrationFailure,
        });
    } finally {
        request.dispose();
    }
}

function getPlaybackDevice(requestJson, rejectedDevice) {
    if (retryAfter && Date.now() >= retryAfter) {
        registration = undefined;
        retryAfter = 0;
    }
    if (rejectedDevice && registration) {
        const previous = registration;
        return previous.then(current => {
            // Concurrent and late failures must share the newest device, with at most one renewal per minute.
            if (registration !== previous || current !== rejectedDevice || Date.now() < refreshAfter) return registration;
            refreshAfter = Date.now() + 60000;
            const renewal = Promise.resolve().then(() => registerPlaybackDevice(requestJson)).catch(error => {
                if (registration === renewal) registration = previous;
                throw error;
            });
            registration = renewal;
            return registration;
        });
    }
    // Share failures briefly to avoid concurrent retries, then allow recovery without restarting.
    registration ||= Promise.resolve().then(() => registerPlaybackDevice(requestJson)).catch(error => {
        retryAfter = Date.now() + 10000;
        throw error;
    });
    return registration;
}

function createPlaybackIdentityManager({ register = registerPlaybackDevice, now = Date.now } = {}) {
    let identity = null, pending = null, registeredAt = 0, refreshAfter = 0, retryAfter = 0;
    let renewals = 0, state = 'uninitialized', lastFailure = null;
    const cancelled = signal => Object.assign(new Error(signal?.reason?.name === 'TimeoutError' ? 'App 片源请求超时' : '已取消 App 片源请求'), {
        code: signal?.reason?.name === 'TimeoutError' ? 'ETIMEDOUT' : 'ERR_CANCELED',
    });
    function join(operation, signal) {
        const subscriber = {};
        operation.subscribers.add(subscriber);
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (callback, value) => {
                if (done) return;
                done = true;
                signal?.removeEventListener('abort', abort);
                operation.subscribers.delete(subscriber);
                callback(value);
            };
            const abort = () => {
                finish(reject, cancelled(signal));
                if (!operation.subscribers.size) operation.controller.abort();
            };
            operation.promise.then(value => finish(resolve, value), error => finish(reject, error));
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
        });
    }
    return {
        acquire(requestJson, { signal, rejectedDevice, reason, timeoutMs } = {}) {
            if (signal?.aborted) return Promise.reject(cancelled(signal));
            // Empty 200 bodies alone do not establish that a device has expired.
            // Only an explicit expiry classification can replace a live identity.
            const expired = rejectedDevice === identity && reason === 'DEVICE_IDENTITY_EXPIRED';
            if (expired && now() < refreshAfter) {
                identity = null;
                state = 'expired';
                retryAfter = refreshAfter;
                lastFailure = Object.assign(new Error('播放设备已失效，请稍后重新初始化'), { code: 'DEVICE_IDENTITY_EXPIRED' });
                return Promise.reject(lastFailure);
            }
            if (expired && !pending) {
                identity = null;
                refreshAfter = now() + DEVICE_REGISTRATION.refreshCooldownMs;
                renewals++;
            }
            if (identity) return Promise.resolve(identity);
            if (pending?.controller.signal.aborted) pending = null;
            if (!pending) {
                if (now() < retryAfter) {
                    return Promise.reject(lastFailure || Object.assign(new Error('播放设备初始化暂不可用，请稍后重试'), { code: 'DEVICE_REGISTRATION_FAILED' }));
                }
                const operation = { controller: new AbortController(), subscribers: new Set(), promise: null };
                pending = operation;
                state = 'registering';
                operation.promise = Promise.resolve().then(() => register(requestJson, { signal: operation.controller.signal, timeoutMs })).then(value => {
                    if (operation.controller.signal.aborted) throw cancelled(operation.controller.signal);
                    if (pending === operation) { identity = value; registeredAt = now(); retryAfter = 0; lastFailure = null; state = 'ready'; }
                    return value;
                }).catch(error => {
                    if (pending === operation) {
                        state = operation.controller.signal.aborted ? 'uninitialized' : 'failed';
                        if (!operation.controller.signal.aborted) {
                            retryAfter = now() + DEVICE_REGISTRATION.failureCooldownMs;
                            const code = ['DEVICE_REGISTRATION_FAILED', 'DEVICE_IDENTITY_EXPIRED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error.code)
                                ? error.code : 'DEVICE_REGISTRATION_FAILED';
                            const reason = ['TIMEOUT', 'NETWORK_ERROR', 'EMPTY_RESPONSE', 'INVALID_RESPONSE', 'BUSINESS_REJECTED', 'SECURITY_BLOCKED'].includes(error.registrationFailure)
                                || /^HTTP_[345]\d{2}$/.test(error.registrationFailure || '') ? error.registrationFailure : 'UNKNOWN';
                            lastFailure = Object.assign(new Error('播放设备初始化暂不可用，请稍后重试'), { code, registrationFailure: reason });
                        }
                    }
                    throw error;
                }).finally(() => { if (pending === operation) pending = null; });
            }
            return join(pending, signal);
        },
        status: () => ({ state, registeredAt, renewals, pending: !!pending }),
    };
}

module.exports = { getPlaybackDevice, registerPlaybackDevice, createPlaybackIdentityManager };
