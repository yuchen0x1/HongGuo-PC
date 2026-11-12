import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from './icons';

// 检测更新设置：从设置页迁出的独立块，更改立即保存。
// 正式 Windows x64 安装版支持应用内下载与用户确认安装；便携版/开发版仍回退到发布页。
export default function UpdateCheckSettings() {
  const [enabled, setEnabled] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    window.electronAPI.getSettings().then(settings => {
      if (active) setEnabled(settings?.app_updates_enabled !== false);
    }).catch(() => { if (active) setError('更新设置读取失败，请重启软件后重试。'); });
    return () => { active = false; };
  }, []);

  const update = async next => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true); setError(''); setSaved(false);
    try {
      const result = await window.electronAPI.saveSettings({ app_updates_enabled: next });
      if (!result?.success) throw new Error(result?.error || '保存失败，原更新设置已保留。');
      setEnabled(next);
      setSaved(true);
    } catch (cause) {
      setError(cause.message || '保存失败，原更新设置已保留。');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return <div className="settings-group">
    <span className="settings-label">检测更新</span>
    <label className="proxy-switch-row"><input type="checkbox" aria-label="自动检测更新" checked={enabled === true} disabled={enabled === null || saving}
      onChange={event => update(event.target.checked)} /><span className="proxy-switch-text">自动检测更新<em>启动时及运行期间每 6 小时检查正式新版；安装版可在应用内下载并由你确认重启安装。</em></span></label>
    <button type="button" className="btn btn-outline" disabled={enabled === false} onClick={() => window.dispatchEvent(new CustomEvent('hongguo-check-app-update'))}><RefreshCw size={15} />检查更新</button>
    <p className="settings-hint">更改立即保存。便携版、开发版或更新失败时，可从更新提醒进入 GitHub 发布页手动安装。</p>
    {saving && <p className="settings-hint" role="status">正在保存…</p>}
    {saved && !saving && <p className="settings-hint" role="status">已保存</p>}
    {error && <p className="alert alert-error" role="alert">{error}</p>}
  </div>;
}
