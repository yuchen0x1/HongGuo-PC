import React, { useEffect, useRef, useState } from 'react';
import { Activity, Download, Shield } from './icons';
import { diagnosticRows, diagnosticCheckRows, diagnosticFaultLabel } from './playbackDiagnosticDisplay.mjs';

const unpack = result => result?.diagnostics || result;

export default function PlaybackDiagnostics({ active = true }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [checks, setChecks] = useState(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current++; };
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let reading = false;
    const read = async () => {
      if (reading || pending.current) return;
      const current = revision.current;
      reading = true;
      try {
        const result = await window.electronAPI.getPlaybackDiagnostics();
        if (alive && current === revision.current) {
          if (result && result.success !== false) { setDiagnostics(unpack(result)); setLoadError(''); }
          else setLoadError('播放诊断暂时无法读取，请稍后重试。');
        }
      } catch { if (alive && current === revision.current) setLoadError('播放诊断暂时无法读取，请稍后重试。'); }
      finally { reading = false; }
    };
    void read();
    const timer = setInterval(read, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [active]);

  const run = async kind => {
    if (pending.current) return;
    pending.current = true;
    revision.current++;
    setBusy(kind); setNotice(''); setError('');
    if (kind === 'connection') setChecks(null);
    try {
      const api = window.electronAPI;
      const result = await (kind === 'account' ? api.checkPlaybackAccount()
        : kind === 'connection' ? api.testPlaybackConnection() : api.exportPlaybackDiagnostics());
      if (!mounted.current || result?.cancelled) return;
      if (result?.diagnostics) setDiagnostics(result.diagnostics);
      if (kind === 'connection') setChecks(result?.checks || { source: 'not-tested', media: 'not-tested', decode: 'not-tested' });
      if (!result || result.success === false) {
        setError(result?.faultCode ? diagnosticFaultLabel(result.faultCode) : kind === 'account' ? '账号状态检查未完成，请稍后重试。'
          : kind === 'connection' ? '播放连接检查未通过。' : '播放诊断报告导出失败，请稍后重试。');
        return;
      }
      if (kind === 'account') {
        const status = result.diagnostics?.sessionValidity;
        setNotice(status === 'valid' ? '账号会话有效。' : status === 'none' ? '当前未登录红果账号。'
          : status === 'expired' || status === 'invalid' ? '账号会话已失效，请重新扫码登录。' : '账号状态已更新。');
      } else if (kind === 'connection') setNotice('连接检查已完成。');
      else setNotice('播放诊断报告已导出。');
    } catch {
      if (mounted.current) setError(kind === 'account' ? '账号状态检查失败，请稍后重试。'
        : kind === 'connection' ? '播放连接检查失败，请稍后重试。' : '播放诊断报告导出失败，请稍后重试。');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy('');
    }
  };

  return <div className="settings-group playback-diagnostics" aria-busy={!!busy}>
    <h3 className="settings-label">播放诊断</h3>
    <dl className="playback-diagnostics-grid">
      {diagnosticRows(diagnostics || {}).map(([label, value]) => <div key={label} className="playback-diagnostics-row">
        <dt>{label}</dt><dd>{value}</dd>
      </div>)}
    </dl>
    <div className="playback-diagnostics-actions">
      <button type="button" className="btn btn-outline btn-sm" disabled={!!busy || !active} onClick={() => run('account')}>
        <Shield size={15} />{busy === 'account' ? '正在检查账号…' : '检查账号状态'}
      </button>
      <button type="button" className="btn btn-outline btn-sm" disabled={!!busy || !active} onClick={() => run('connection')}>
        <Activity size={15} />{busy === 'connection' ? '正在检查连接…' : '测试播放连接'}
      </button>
      <button type="button" className="btn btn-outline btn-sm" disabled={!!busy || !active} onClick={() => run('export')}>
        <Download size={15} />{busy === 'export' ? '正在导出…' : '导出播放诊断报告'}
      </button>
    </div>
    {checks && <dl className="playback-connection-result" aria-label="播放连接检查结果">
      {diagnosticCheckRows(checks).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>}
    {notice && <p className="settings-hint" role="status">{notice}</p>}
    {(error || loadError) && <p className="appearance-error" role="alert">{error || loadError}</p>}
  </div>;
}
