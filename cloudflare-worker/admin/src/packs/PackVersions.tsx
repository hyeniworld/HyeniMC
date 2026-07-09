import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface Version { version: string; changelog: string; breaking: boolean; }

export function PackVersions({ packId, onToast, onChanged }: {
  packId: string; onToast: (m: string, k?: 'ok' | 'err') => void; onChanged: () => void;
}) {
  const [latest, setLatest] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [confirm, setConfirm] = useState<{ msg: string; act: () => void } | null>(null);

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

  return (
    <div>
      <h3>버전 (현재 latest: {latest ?? '없음'})</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['버전', 'breaking', 'changelog', '액션'].map((h) => (
          <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>{h}</th>
        ))}</tr></thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version}>
              <td style={{ padding: 6 }}>{v.version}{v.version === latest ? ' ★' : ''}</td>
              <td style={{ padding: 6 }}>
                <button onClick={() => run(() => api.editPackVersion(packId, v.version, { breaking: !v.breaking }), `${v.version} breaking=${!v.breaking}`)}>
                  {v.breaking ? '⚠️ true' : 'false'}</button>
              </td>
              <td style={{ padding: 6, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.changelog}</td>
              <td style={{ padding: 6, display: 'flex', gap: 6 }}>
                <button disabled={v.version === latest}
                  onClick={() => run(() => api.rollbackPack(packId, v.version), `latest→${v.version}`)}>롤백</button>
                <button disabled={v.version === latest}
                  onClick={() => setConfirm({
                    msg: `${packId} ${v.version} 삭제할까요?`,
                    act: () => run(() => api.deletePackVersion(packId, v.version), `${v.version} 삭제됨`),
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
