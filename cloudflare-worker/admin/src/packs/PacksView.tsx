import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { PackVersions } from './PackVersions';
import { PackPublishForm } from './PackPublishForm';

interface Pack { id: string; latestVersion: string; breaking: boolean; }

export function PacksView({ onToast }: { onToast: (m: string, k?: 'ok' | 'err') => void }) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    try { setPacks((await api.listPacks()).packs); }
    catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [refreshKey]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24 }}>
      <aside>
        <h3>혜니팩</h3>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 4 }}>
          {packs.map((p) => (
            <li key={p.id}>
              <button style={{ width: '100%', textAlign: 'left', fontWeight: p.id === selected ? 700 : 400 }}
                onClick={() => setSelected(p.id)}>{p.id} <small>({p.latestVersion})</small></button>
            </li>
          ))}
        </ul>
      </aside>
      <section>
        {selected
          ? <PackVersions packId={selected} onToast={onToast} onChanged={() => setRefreshKey((k) => k + 1)} />
          : <p>왼쪽에서 혜니팩을 선택하세요.</p>}
        <hr style={{ margin: '24px 0' }} />
        <PackPublishForm onToast={onToast} onPublished={() => setRefreshKey((k) => k + 1)} />
      </section>
    </div>
  );
}
