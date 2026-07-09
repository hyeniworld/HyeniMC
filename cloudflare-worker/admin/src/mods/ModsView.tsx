import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ModVersions } from './ModVersions';
import { ModPublishForm } from './ModPublishForm';

interface Mod {
  id: string;
  name: string;
  latestVersion: string;
  category: string;
  gameVersions: string[];
  loaders: { type: string; supportedGameVersions: string[] }[];
}

export function ModsView({ onToast }: { onToast: (m: string, k?: 'ok' | 'err') => void }) {
  const [mods, setMods] = useState<Mod[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fMc, setFMc] = useState('');
  const [fLoader, setFLoader] = useState('');

  async function load() {
    try { setMods((await api.listMods()).mods); }
    catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [refreshKey]);

  const mcOptions = [...new Set(mods.flatMap((m) => m.gameVersions || []))].sort();
  const loaderOptions = [...new Set(mods.flatMap((m) => (m.loaders || []).map((l) => l.type)))].sort();

  function matchesMod(m: Mod): boolean {
    if (fMc && fLoader) return (m.loaders || []).some((l) => l.type === fLoader && (l.supportedGameVersions || []).includes(fMc));
    const okMc = !fMc || (m.gameVersions || []).includes(fMc);
    const okLoader = !fLoader || (m.loaders || []).some((l) => l.type === fLoader);
    return okMc && okLoader;
  }
  const filteredMods = mods.filter(matchesMod);

  return (
    <div class="workspace">
      <aside class="rail">
        <h2 class="rail-title">모드</h2>
        <div class="filterbar">
          <select value={fMc} onChange={(e) => setFMc((e.target as HTMLSelectElement).value)}>
            <option value="">MC 버전 전체</option>
            {mcOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={fLoader} onChange={(e) => setFLoader((e.target as HTMLSelectElement).value)}>
            <option value="">로더 전체</option>
            {loaderOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {(fMc || fLoader) && <button class="filter-reset" onClick={() => { setFMc(''); setFLoader(''); }}>초기화</button>}
          <span class="filter-count">{filteredMods.length}/{mods.length}</span>
        </div>
        <ul class="rail-list">
          {filteredMods.map((m) => (
            <li key={m.id}>
              <button class={`rail-item ${m.id === selected ? 'is-active' : ''}`}
                onClick={() => setSelected(m.id)}>
                <span class="rail-name">{m.name}</span>
                <span class="rail-id">{m.id} · v{m.latestVersion}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div class="main">
        {selected
          ? <ModVersions modId={selected} onToast={onToast} onChanged={() => setRefreshKey((k) => k + 1)} />
          : <div class="panel"><p class="panel-placeholder">왼쪽에서 모드를 선택하세요.</p></div>}
        <ModPublishForm onToast={onToast} onPublished={() => setRefreshKey((k) => k + 1)} />
      </div>
    </div>
  );
}
