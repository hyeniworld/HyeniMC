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
    <div class="workspace">
      <aside class="rail">
        <h2 class="rail-title">혜니팩</h2>
        <ul class="rail-list">
          {packs.map((p) => (
            <li key={p.id}>
              <button class={`rail-item ${p.id === selected ? 'is-active' : ''}`}
                onClick={() => setSelected(p.id)}>
                <span class="rail-name">{p.id}</span>
                <span class="rail-id">v{p.latestVersion}{p.breaking ? ' · breaking' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div class="main">
        {selected
          ? <PackVersions packId={selected} onToast={onToast} onChanged={() => setRefreshKey((k) => k + 1)} />
          : <div class="panel"><p class="panel-placeholder">왼쪽에서 혜니팩을 선택하세요.</p></div>}
        <PackPublishForm onToast={onToast} onPublished={() => setRefreshKey((k) => k + 1)} />
      </div>
    </div>
  );
}
