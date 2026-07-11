import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { ModResolution } from './ModResolution';

interface Target {
  loader: string;
  gameVersion: string;
  minLoaderVersion: string | null;
  maxLoaderVersion: string | null;
  dependencies: Record<string, unknown>;
  file: string | null;
  sha256: string | null;
  size: number | null;
}

interface Version { version: string; releaseDate: string | null; changelog: string; category: string; targets: Target[]; }

interface TargetEdit {
  loader: string;
  gameVersion: string;
  minLoaderVersion: string;
  maxLoaderVersion: string;
  dependencies: string;
}

export function ModVersions({ modId, name, onToast, onChanged }: {
  modId: string; name?: string; onToast: (m: string, k?: 'ok' | 'err') => void; onChanged: () => void;
}) {
  const [latest, setLatest] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [confirm, setConfirm] = useState<{ msg: string; act: () => void } | null>(null);
  const [editing, setEditing] = useState<Version | null>(null);
  const [form, setForm] = useState({ changelog: '', category: 'required' });
  const [tform, setTform] = useState<TargetEdit[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(v: string) {
    setExpanded((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });
  }

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

  /** 삭제 확인 — 핀 지정된 버전이면 경고를 덧붙인다(취소 시 중단). */
  async function confirmDelete(v: Version) {
    let warn = '';
    try {
      const idx = await api.getModIndex(modId);
      const pinnedEnvs: string[] = [];
      for (const [loader, gvs] of Object.entries<any>(idx?.targets ?? {})) {
        for (const [gv, cell] of Object.entries<any>(gvs)) {
          if (cell?.pinned === v.version) pinnedEnvs.push(`${loader}·${gv}`);
        }
      }
      if (pinnedEnvs.length) {
        warn = `\n\n⚠ 이 버전은 ${pinnedEnvs.join(', ')} 환경에 핀 지정되어 있어요. 삭제하면 핀이 해제되어 자동(최고 버전)으로 복귀합니다.`;
      }
    } catch { /* 인덱스 조회 실패 시 경고 없이 기본 확인만 */ }
    setConfirm({
      msg: `${modId} ${v.version} 버전을 삭제할까요?${warn}`,
      act: () => run(() => api.deleteModVersion(modId, v.version), `${v.version} 삭제됨`),
    });
  }

  function openEdit(v: Version) {
    setForm({ changelog: v.changelog, category: v.category });
    setTform(v.targets.map((t) => ({
      loader: t.loader, gameVersion: t.gameVersion,
      minLoaderVersion: t.minLoaderVersion ?? '',
      maxLoaderVersion: t.maxLoaderVersion ?? '',
      dependencies: JSON.stringify(t.dependencies ?? {}),
    })));
    setEditing(v);
  }

  function setT(i: number, patch: Partial<TargetEdit>) {
    setTform((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  async function saveEdit() {
    if (!editing) return;
    const patch: any = { changelog: form.changelog, category: form.category };
    const targets = [];
    for (const t of tform) {
      let deps;
      try { deps = JSON.parse(t.dependencies || '{}'); }
      catch { onToast(`${t.loader}·${t.gameVersion}: dependencies JSON 오류`, 'err'); return; }
      if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) {
        onToast(`${t.loader}·${t.gameVersion}: dependencies는 객체(JSON)여야 합니다`, 'err'); return;
      }
      targets.push({
        loader: t.loader, gameVersion: t.gameVersion,
        minLoaderVersion: t.minLoaderVersion.trim() || null,
        maxLoaderVersion: t.maxLoaderVersion.trim() || null,
        dependencies: deps,
      });
    }
    if (targets.length) patch.targets = targets;
    try {
      await api.editModVersion(modId, editing.version, patch);
      onToast(`${editing.version} 편집됨`);
      setEditing(null);
      await load();
      onChanged();
    } catch (e: any) { onToast(e.message, 'err'); }
  }

  return (
    <>
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">{name || modId}</h3>
          <span class="panel-id mono">modId: {modId}</span>
        </div>
        <span class="panel-sub" title="쿼리 없이 조회하는 구(Electron) 런처가 받는 버전. 신(Tauri) 런처는 아래 '환경별 최신'을 받습니다.">전역 latest(구 런처용): {latest ? <span class="mono">{latest}</span> : '없음'}</span>
      </div>
      <div class="notice">전역 latest와 아래 <b>latest</b> 배지·"latest로 지정"은 <b>구(Electron) 런처 전용</b>이에요. 신(Tauri) 런처는 하단 <b>환경별 최신</b>(핀 → 자동)을 따릅니다. 전역 latest 버전만 삭제가 차단돼요(다른 버전을 latest로 지정한 뒤 삭제). 핀·자동(환경별)은 차단 없이 삭제되고, 핀은 해제되어 자동으로 복귀합니다.</div>
      <table class="vtable">
        <thead><tr>{['버전', '카테고리', 'changelog', '액션'].map((h) => (
          <th key={h}>{h}</th>
        ))}</tr></thead>
        <tbody>
          {versions.map((v) => [
            <tr class={`vrow ${v.version === latest ? 'is-latest' : ''}`} key={v.version}>
              <td>
                <button class="expand-btn" onClick={() => toggle(v.version)}>{expanded.has(v.version) ? '▾' : '▸'}</button>
                <span class="vver">{v.version}</span>{v.version === latest && <span class="badge badge-latest" title="전역 latest — 구(Electron) 런처가 받는 버전"> latest</span>}
              </td>
              <td><span class="badge badge-cat">{v.category}</span></td>
              <td class="vchangelog truncate" title={v.changelog}>{v.changelog}</td>
              <td>
                <div class="btn-row">
                  <button class="btn btn-sm" disabled={v.version === latest}
                    title="전역 latest 변경 — 구(Electron) 런처에만 영향. 신 런처는 환경별 최신(핀/자동)을 따릅니다."
                    onClick={() => run(() => api.rollbackMod(modId, v.version), `${v.version} → latest`)}>latest로 지정</button>
                  <button class="btn btn-sm" onClick={() => openEdit(v)}>편집</button>
                  <button class="btn btn-sm btn-danger" disabled={v.version === latest}
                    onClick={() => confirmDelete(v)}>삭제</button>
                </div>
              </td>
            </tr>,
            expanded.has(v.version) && (
              <tr class="vrow-detail" key={v.version + '-d'}>
                <td colspan={4}>
                  {v.changelog && <div class="detail-changelog">{v.changelog}</div>}
                  {v.targets.length === 0 ? <span class="dash">타깃 없음</span> : (
                    <table class="subtable">
                      <thead><tr>{['로더', '게임버전', 'minLoader', 'maxLoader', 'dependencies', '파일'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {v.targets.map((t) => (
                          <tr key={t.loader + t.gameVersion}>
                            <td class="mono">{t.loader}</td>
                            <td class="mono">{t.gameVersion}</td>
                            <td class="mono">{t.minLoaderVersion ?? <span class="dash">—</span>}</td>
                            <td class="mono">{t.maxLoaderVersion ?? <span class="dash">—</span>}</td>
                            <td class="mono">{JSON.stringify(t.dependencies ?? {})}</td>
                            <td class="mono truncate">{t.file ?? <span class="dash">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </td>
              </tr>
            ),
          ])}
        </tbody>
      </table>
      <ConfirmDialog open={!!confirm} message={confirm?.msg ?? ''}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { confirm?.act(); setConfirm(null); }} />
      <Modal open={!!editing} title={<>버전 편집 <span class="mono">{editing?.version}</span></>} onClose={() => setEditing(null)}>
        <div class="dialog-body">
          <label class="field"><span>changelog</span>
            <textarea value={form.changelog} onInput={(e) => setForm({ ...form, changelog: (e.target as HTMLTextAreaElement).value })} /></label>
          <label class="field"><span>category</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: (e.target as HTMLSelectElement).value })}>
              <option value="required">required</option><option value="optional">optional</option></select></label>
          {tform.length > 0 && (
            <div class="field-group">
              <span class="field-legend">로더별 값 (해당 로더/게임버전에만 적용)</span>
              {tform.map((t, i) => (
                <div class="target-edit" key={t.loader + t.gameVersion}>
                  <span class="target-edit-head">{t.loader} · {t.gameVersion}</span>
                  <div class="dialog-grid">
                    <label class="field"><span>minLoaderVersion</span>
                      <input value={t.minLoaderVersion} onInput={(e) => setT(i, { minLoaderVersion: (e.target as HTMLInputElement).value })} /></label>
                    <label class="field"><span>maxLoaderVersion</span>
                      <input value={t.maxLoaderVersion} onInput={(e) => setT(i, { maxLoaderVersion: (e.target as HTMLInputElement).value })} /></label>
                  </div>
                  <label class="field"><span>dependencies (JSON)</span>
                    <input value={t.dependencies} onInput={(e) => setT(i, { dependencies: (e.target as HTMLInputElement).value })} /></label>
                </div>
              ))}
            </div>
          )}
        </div>
        <div class="dialog-actions">
          <button class="btn" onClick={() => setEditing(null)}>취소</button>
          <button class="btn btn-primary" onClick={saveEdit}>저장</button>
        </div>
      </Modal>
    </div>
      <ModResolution modId={modId} versions={versions} onToast={onToast} />
    </>
  );
}
