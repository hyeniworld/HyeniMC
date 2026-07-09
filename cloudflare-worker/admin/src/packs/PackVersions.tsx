import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';

interface Version { version: string; changelog: string; breaking: boolean; }

export function PackVersions({ packId, onToast, onChanged }: {
  packId: string; onToast: (m: string, k?: 'ok' | 'err') => void; onChanged: () => void;
}) {
  const [latest, setLatest] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [confirm, setConfirm] = useState<{ msg: string; act: () => void } | null>(null);
  const [editing, setEditing] = useState<Version | null>(null);
  const [form, setForm] = useState({ changelog: '', breaking: false });

  async function load() {
    try {
      const data = await api.listPackVersions(packId);
      setLatest(data.latestVersion); setVersions(data.versions);
    } catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [packId]);

  async function run(action: () => Promise<any>, ok: string) {
    try { await action(); onToast(ok); await load(); onChanged(); }
    catch (e: any) { onToast(e.message, 'err'); }
  }

  function openEdit(v: Version) {
    setForm({ changelog: v.changelog, breaking: v.breaking });
    setEditing(v);
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api.editPackVersion(packId, editing.version, { changelog: form.changelog, breaking: form.breaking });
      onToast(`${editing.version} 편집됨`);
      setEditing(null);
      await load();
      onChanged();
    } catch (e: any) { onToast(e.message, 'err'); }
  }

  return (
    <div class="panel">
      <div class="panel-head">
        <h3 class="panel-title mono">{packId}</h3>
        <span class="panel-sub">현재 latest: {latest ? <span class="mono">{latest}</span> : '없음'}</span>
      </div>
      <div class="notice">latest 버전은 삭제할 수 없어요. 다른 버전을 latest로 지정한 뒤 삭제하세요.</div>
      <table class="vtable">
        <thead><tr>{['버전', 'breaking', 'changelog', '액션'].map((h) => (
          <th key={h}>{h}</th>
        ))}</tr></thead>
        <tbody>
          {versions.map((v) => (
            <tr class={`vrow ${v.version === latest ? 'is-latest' : ''}`} key={v.version}>
              <td><span class="vver">{v.version}</span>{v.version === latest && <span class="badge badge-latest"> latest</span>}</td>
              <td>
                <button class={`badge ${v.breaking ? 'badge-breaking' : 'badge-cat'}`}
                  onClick={() => run(() => api.editPackVersion(packId, v.version, { breaking: !v.breaking }), `${v.version} breaking=${!v.breaking}`)}>
                  {v.breaking ? '⚠ breaking' : 'false'}</button>
              </td>
              <td class="vchangelog truncate">{v.changelog}</td>
              <td>
                <div class="btn-row">
                  <button class="btn btn-sm" disabled={v.version === latest}
                    onClick={() => run(() => api.rollbackPack(packId, v.version), `${v.version} → latest`)}>latest로 지정</button>
                  <button class="btn btn-sm" onClick={() => openEdit(v)}>편집</button>
                  <button class="btn btn-sm btn-danger" disabled={v.version === latest}
                    onClick={() => setConfirm({
                      msg: `${packId} ${v.version} 삭제할까요?`,
                      act: () => run(() => api.deletePackVersion(packId, v.version), `${v.version} 삭제됨`),
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
          <label class="checkbox"><input type="checkbox" checked={form.breaking}
            onChange={(e) => setForm({ ...form, breaking: (e.target as HTMLInputElement).checked })} /> breaking (호환 불가 업데이트)</label>
        </div>
        <div class="dialog-actions">
          <button class="btn" onClick={() => setEditing(null)}>취소</button>
          <button class="btn btn-primary" onClick={saveEdit}>저장</button>
        </div>
      </Modal>
    </div>
  );
}
