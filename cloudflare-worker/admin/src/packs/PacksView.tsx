import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { PackVersions } from './PackVersions';
import { PackPublishForm } from './PackPublishForm';

interface Pack {
  id: string;
  latestVersion: string;
  breaking: boolean;
  minecraft: { version: string; loaderType: string; loaderVersion: string } | null;
}

export function PacksView({ onToast }: { onToast: (m: string, k?: 'ok' | 'err') => void }) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fMc, setFMc] = useState('');
  const [fLoader, setFLoader] = useState('');
  const [fLoaderVer, setFLoaderVer] = useState('');

  async function load() {
    try { setPacks((await api.listPacks()).packs); }
    catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [refreshKey]);

  const mcOptions = [...new Set(packs.map((p) => p.minecraft?.version).filter(Boolean))].sort() as string[];
  const loaderOptions = [...new Set(packs.map((p) => p.minecraft?.loaderType).filter(Boolean))].sort() as string[];
  const loaderVerOptions = [...new Set(packs.filter((p) => !fLoader || p.minecraft?.loaderType === fLoader).map((p) => p.minecraft?.loaderVersion).filter(Boolean))].sort() as string[];

  function matchesPack(p: Pack): boolean {
    const mc = p.minecraft;
    return (!fMc || mc?.version === fMc) && (!fLoader || mc?.loaderType === fLoader) && (!fLoaderVer || mc?.loaderVersion === fLoaderVer);
  }
  const filteredPacks = packs.filter(matchesPack);

  return (
    <div class="workspace">
      <aside class="rail">
        <h2 class="rail-title">혜니팩</h2>
        <div class="filterbar">
          <select value={fMc} onChange={(e) => setFMc((e.target as HTMLSelectElement).value)}>
            <option value="">MC 버전 전체</option>
            {mcOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={fLoader} onChange={(e) => setFLoader((e.target as HTMLSelectElement).value)}>
            <option value="">로더 전체</option>
            {loaderOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={fLoaderVer} onChange={(e) => setFLoaderVer((e.target as HTMLSelectElement).value)}>
            <option value="">로더버전 전체</option>
            {loaderVerOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          {(fMc || fLoader || fLoaderVer) && <button class="filter-reset" onClick={() => { setFMc(''); setFLoader(''); setFLoaderVer(''); }}>초기화</button>}
          <span class="filter-count">{filteredPacks.length}/{packs.length}</span>
        </div>
        <ul class="rail-list">
          {filteredPacks.map((p) => (
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
