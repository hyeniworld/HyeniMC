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
    <div>
      <h3>버전 (현재 latest: {latest ?? '없음'})</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['버전', '카테고리', 'changelog', '액션'].map((h) => (
          <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>{h}</th>
        ))}</tr></thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version}>
              <td style={{ padding: 6 }}>{v.version}{v.version === latest ? ' ★' : ''}</td>
              <td style={{ padding: 6 }}>{v.category}</td>
              <td style={{ padding: 6, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.changelog}</td>
              <td style={{ padding: 6, display: 'flex', gap: 6 }}>
                <button disabled={v.version === latest}
                  onClick={() => run(() => api.rollbackMod(modId, v.version), `latest→${v.version}`)}>롤백</button>
                <button onClick={() => editChangelog(v)}>편집</button>
                <button disabled={v.version === latest}
                  onClick={() => setConfirm({
                    msg: `${modId} ${v.version} 버전을 삭제할까요?`,
                    act: () => run(() => api.deleteModVersion(modId, v.version), `${v.version} 삭제됨`),
                  })}>삭제</button>
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
