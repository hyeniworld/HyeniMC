import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface Version { version: string; releaseDate: string | null; changelog: string; category: string; }

export function ModVersions({ modId, onToast, onChanged }: {
  modId: string; onToast: (m: string, k?: 'ok' | 'err') => void; onChanged: () => void;
}) {
  const [latest, setLatest] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [confirm, setConfirm] = useState<{ msg: string; act: () => void } | null>(null);

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

  async function editChangelog(v: Version) {
    const next = prompt('changelog', v.changelog);
    if (next === null) return;
    run(() => api.editModVersion(modId, v.version, { changelog: next }), `${v.version} 편집됨`);
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
                  <button class="btn btn-sm" onClick={() => editChangelog(v)}>편집</button>
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
    </div>
  );
}
