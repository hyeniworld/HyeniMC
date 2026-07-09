import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';

interface Version { version: string; releaseDate: string | null; changelog: string; category: string; }

export function ModVersions({ modId, onToast, onChanged }: {
  modId: string; onToast: (m: string, k?: 'ok' | 'err') => void; onChanged: () => void;
}) {
  const [latest, setLatest] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [confirm, setConfirm] = useState<{ msg: string; act: () => void } | null>(null);
  const [editing, setEditing] = useState<Version | null>(null);
  const [form, setForm] = useState({ changelog: '', category: 'required', minLoaderVersion: '', maxLoaderVersion: '', dependencies: '' });

  async function load() {
    try {
      const data = await api.listModVersions(modId);
      setLatest(data.latestVersion);
      setVersions(data.versions);
    } catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [modId]);

  async function run(action: () => Promise<any>, ok: string) {
    try { await action(); onToast(ok); await load(); onChanged(); }
    catch (e: any) { onToast(e.message, 'err'); }
  }

  function openEdit(v: Version) {
    setForm({ changelog: v.changelog, category: v.category, minLoaderVersion: '', maxLoaderVersion: '', dependencies: '' });
    setEditing(v);
  }

  async function saveEdit() {
    if (!editing) return;
    const patch: any = { changelog: form.changelog, category: form.category };
    if (form.minLoaderVersion.trim()) patch.minLoaderVersion = form.minLoaderVersion.trim();
    if (form.maxLoaderVersion.trim()) patch.maxLoaderVersion = form.maxLoaderVersion.trim();
    if (form.dependencies.trim()) {
      try { patch.dependencies = JSON.parse(form.dependencies); }
      catch { onToast('dependencies가 유효한 JSON이 아닙니다.', 'err'); return; }
    }
    try {
      await api.editModVersion(modId, editing.version, patch);
      onToast(`${editing.version} 편집됨`);
      setEditing(null);
      await load();
      onChanged();
    } catch (e: any) { onToast(e.message, 'err'); }
  }

  return (
    <div class="panel">
      <div class="panel-head">
        <h3 class="panel-title mono">{modId}</h3>
        <span class="panel-sub">현재 latest: {latest ? <span class="mono">{latest}</span> : '없음'}</span>
      </div>
      <div class="notice">latest 버전은 삭제할 수 없어요. 다른 버전을 latest로 지정한 뒤 삭제하세요.</div>
      <table class="vtable">
        <thead><tr>{['버전', '카테고리', 'changelog', '액션'].map((h) => (
          <th key={h}>{h}</th>
        ))}</tr></thead>
        <tbody>
          {versions.map((v) => (
            <tr class={`vrow ${v.version === latest ? 'is-latest' : ''}`} key={v.version}>
              <td><span class="vver">{v.version}</span>{v.version === latest && <span class="badge badge-latest"> latest</span>}</td>
              <td><span class="badge badge-cat">{v.category}</span></td>
              <td class="vchangelog truncate">{v.changelog}</td>
              <td>
                <div class="btn-row">
                  <button class="btn btn-sm" disabled={v.version === latest}
                    onClick={() => run(() => api.rollbackMod(modId, v.version), `${v.version} → latest`)}>latest로 지정</button>
                  <button class="btn btn-sm" onClick={() => openEdit(v)}>편집</button>
                  <button class="btn btn-sm btn-danger" disabled={v.version === latest}
                    onClick={() => setConfirm({
                      msg: `${modId} ${v.version} 버전을 삭제할까요?`,
                      act: () => run(() => api.deleteModVersion(modId, v.version), `${v.version} 삭제됨`),
                    })}>삭제</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog open={!!confirm} message={confirm?.msg ?? ''}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { confirm?.act(); setConfirm(null); }} />
      <Modal open={!!editing} title={<>버전 편집 <span class="mono">{editing?.version}</span></>} onClose={() => setEditing(null)}>
        <div class="dialog-body">
          <label class="field"><span>changelog</span>
            <textarea value={form.changelog} onInput={(e) => setForm({ ...form, changelog: (e.target as HTMLTextAreaElement).value })} /></label>
          <label class="field"><span>category</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: (e.target as HTMLSelectElement).value })}>
              <option value="required">required</option><option value="optional">optional</option></select></label>
          <div class="field-group">
            <span class="field-legend">고급 · 비워두면 변경 안 함 · 입력 시 이 버전의 모든 로더/게임버전에 일괄 적용</span>
            <div class="dialog-grid">
              <label class="field"><span>minLoaderVersion</span>
                <input value={form.minLoaderVersion} onInput={(e) => setForm({ ...form, minLoaderVersion: (e.target as HTMLInputElement).value })} /></label>
              <label class="field"><span>maxLoaderVersion</span>
                <input value={form.maxLoaderVersion} onInput={(e) => setForm({ ...form, maxLoaderVersion: (e.target as HTMLInputElement).value })} /></label>
            </div>
            <label class="field"><span>dependencies (JSON)</span>
              <input value={form.dependencies} placeholder="{}" onInput={(e) => setForm({ ...form, dependencies: (e.target as HTMLInputElement).value })} /></label>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn" onClick={() => setEditing(null)}>취소</button>
          <button class="btn btn-primary" onClick={saveEdit}>저장</button>
        </div>
      </Modal>
    </div>
  );
}
