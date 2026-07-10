import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { sortVersions } from '../lib/versions';

interface Version { version: string; targets: { loader: string; gameVersion: string }[]; }
type Cell = { auto: string; pinned: string | null };
type Index = { targets: Record<string, Record<string, Cell>> };

export function ModResolution({ modId, versions, onToast }: {
  modId: string;
  versions: Version[];
  onToast: (m: string, k?: 'ok' | 'err') => void;
}) {
  const [index, setIndex] = useState<Index>({ targets: {} });

  async function load() {
    try { setIndex(await api.getModIndex(modId)); }
    catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [modId, versions]);

  // (loader,gv) → 그 타깃을 제공하는 버전 목록
  const offered: Record<string, string[]> = {};
  for (const v of versions) {
    for (const t of v.targets || []) {
      const key = `${t.loader}|${t.gameVersion}`;
      (offered[key] ??= []).push(v.version);
    }
  }
  const rows = Object.entries(offered)
    .map(([key, vers]) => {
      const [loader, gameVersion] = key.split('|');
      const cell = index.targets?.[loader]?.[gameVersion];
      return { loader, gameVersion, offered: vers, auto: cell?.auto ?? null, pinned: cell?.pinned ?? null };
    })
    .sort((a, b) => a.loader.localeCompare(b.loader) || a.gameVersion.localeCompare(b.gameVersion));

  async function pin(loader: string, gameVersion: string, version: string | null) {
    try {
      await api.setModPin(modId, { loader, gameVersion, version });
      onToast(version ? `${loader}·${gameVersion} → ${version} 고정` : `${loader}·${gameVersion} 자동`);
      await load();
    } catch (e: any) { onToast(e.message, 'err'); }
  }

  if (rows.length === 0) return null;

  return (
    <div class="panel">
      <div class="panel-head"><h3 class="panel-title">환경별 최신</h3>
        <span class="panel-sub">신(Tauri) 런처가 (로더·MC버전)별로 받는 버전 — 핀이 없으면 자동(최고 버전)</span></div>
      <table class="vtable">
        <thead><tr>{['로더', 'MC 버전', '해석된 latest', '지정'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const resolved = r.pinned ?? r.auto;
            return (
              <tr key={`${r.loader}|${r.gameVersion}`}>
                <td class="mono">{r.loader}</td>
                <td class="mono">{r.gameVersion}</td>
                <td class="mono">{resolved ?? '—'} <span class="faint">{r.pinned ? '(고정)' : '(자동)'}</span></td>
                <td>
                  <select value={r.pinned ?? ''}
                    onChange={(e) => {
                      const val = (e.target as HTMLSelectElement).value;
                      pin(r.loader, r.gameVersion, val === '' ? null : val);
                    }}>
                    <option value="">자동 ({r.auto ?? '—'})</option>
                    {sortVersions(r.offered).reverse().map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
