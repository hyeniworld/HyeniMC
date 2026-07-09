import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ModVersions } from './ModVersions';
import { ModPublishForm } from './ModPublishForm';

interface Mod { id: string; name: string; latestVersion: string; category: string; }

export function ModsView({ onToast }: { onToast: (m: string, k?: 'ok' | 'err') => void }) {
  const [mods, setMods] = useState<Mod[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    try { setMods((await api.listMods()).mods); }
    catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [refreshKey]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24 }}>
      <aside>
        <h3>모드</h3>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 4 }}>
          {mods.map((m) => (
            <li key={m.id}>
              <button style={{ width: '100%', textAlign: 'left', fontWeight: m.id === selected ? 700 : 400 }}
                onClick={() => setSelected(m.id)}>{m.name} <small>({m.latestVersion})</small></button>
            </li>
          ))}
        </ul>
      </aside>
      <section>
        {selected
          ? <ModVersions modId={selected} onToast={onToast} onChanged={() => setRefreshKey((k) => k + 1)} />
          : <p>왼쪽에서 모드를 선택하세요.</p>}
        <hr style={{ margin: '24px 0' }} />
        <ModPublishForm onToast={onToast} onPublished={() => setRefreshKey((k) => k + 1)} />
      </section>
    </div>
  );
}
