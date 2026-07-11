import { useState } from 'preact/hooks';
import * as api from '../api';
import { validateModPublish, type ModFileInput } from '../lib/validate';
import { buildModPublishForm } from '../lib/formdata';
import { Field } from '../components/Field';

const emptyFile = (): ModFileInput => ({
  loader: 'neoforge', gameVersion: '1.21.1', file: null, fileName: '',
  minLoaderVersion: '', maxLoaderVersion: '', dependencies: '{}',
});

export function ModPublishForm({ initialModId, onToast, onPublished }: {
  initialModId?: string; onToast: (m: string, k?: 'ok' | 'err') => void; onPublished: () => void;
}) {
  const [modId, setModId] = useState(initialModId ?? '');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [category, setCategory] = useState('required');
  const [changelog, setChangelog] = useState('');
  const [files, setFiles] = useState<ModFileInput[]>([emptyFile()]);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  function setFile(i: number, patch: Partial<ModFileInput>) {
    setFiles((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  async function submit(e: Event) {
    e.preventDefault();
    const input = { modId, name, version, category, changelog, files };
    const errors = validateModPublish(input);
    if (errors.length) { onToast(errors[0], 'err'); return; }

    const fileMap = new Map<string, File>();
    const metaFiles = files.map((f, i) => {
      const field = `jar${i}`;
      fileMap.set(field, f.file!);
      return {
        loader: f.loader, gameVersion: f.gameVersion, fileField: field, fileName: f.fileName,
        minLoaderVersion: f.minLoaderVersion || null,
        maxLoaderVersion: f.maxLoaderVersion || null,
        dependencies: JSON.parse(f.dependencies || '{}'),
      };
    });
    const meta = { modId, name, version, category, changelog, files: metaFiles };

    setBusy(true);
    try {
      const res = await api.publishMod(modId, buildModPublishForm(meta, fileMap), overwrite);
      onToast(`게시됨: ${modId}@${res.version} (${res.files.length}개 파일)`);
      onPublished();
    } catch (e: any) { onToast(e.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <form class="dialog-form-body" onSubmit={submit}>
      <div class="notice">기존 latest보다 높거나 같은 버전을 게시하면 latest가 됩니다(낮은 버전은 백필만). 환경별 latest는 자동 재계산됩니다(핀 우선).</div>
      <div class="notice">프리릴리즈는 <span class="mono">x.y.z-(alpha|beta|pre)NNN</span> 형식만 지원합니다(예: <span class="mono">1.2.3-beta001</span>, 순서 alpha&lt;beta&lt;pre&lt;정식). 프리릴리즈는 latest·환경별 자동 최신으로 <b>승격되지 않으며</b>, 배포하려면 환경별 핀으로 지정해야 합니다 — 핀 = 해당 환경 <b>모든 사용자</b>에게 배포.</div>
      <div class="form-grid">
        <Field label="modId"><input value={modId} onInput={(e) => setModId((e.target as HTMLInputElement).value)} /></Field>
        <Field label="name"><input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field label="version"><input value={version} placeholder="1.2.3 또는 1.2.3-beta001" onInput={(e) => setVersion((e.target as HTMLInputElement).value)} /></Field>
        <Field label="category">
          <select value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>
            <option value="required">required</option>
            <option value="optional">optional</option>
          </select>
        </Field>
      </div>
      <Field label="changelog"><textarea value={changelog} onInput={(e) => setChangelog((e.target as HTMLTextAreaElement).value)} /></Field>

      <h4 class="rail-title">파일</h4>
      <div class="file-rows">
        {files.map((f, i) => (
          <div class="file-row" key={i}>
            <Field label="loader"><input value={f.loader} onInput={(e) => setFile(i, { loader: (e.target as HTMLInputElement).value })} /></Field>
            <Field label="gameVersion"><input value={f.gameVersion} onInput={(e) => setFile(i, { gameVersion: (e.target as HTMLInputElement).value })} /></Field>
            <Field label="jar">
              <input type="file" accept=".jar" onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0] ?? null;
                setFile(i, { file, fileName: file?.name ?? '' });
              }} />
            </Field>
            <Field label="minLoaderVersion"><input value={f.minLoaderVersion} onInput={(e) => setFile(i, { minLoaderVersion: (e.target as HTMLInputElement).value })} /></Field>
            <Field label="maxLoaderVersion"><input value={f.maxLoaderVersion} onInput={(e) => setFile(i, { maxLoaderVersion: (e.target as HTMLInputElement).value })} /></Field>
            <Field label="dependencies(JSON)"><input value={f.dependencies} onInput={(e) => setFile(i, { dependencies: (e.target as HTMLInputElement).value })} /></Field>
            <button type="button" class="btn btn-sm btn-danger" disabled={files.length === 1} onClick={() => setFiles((fs) => fs.filter((_, idx) => idx !== i))}>삭제</button>
          </div>
        ))}
      </div>
      <button type="button" class="btn btn-sm" onClick={() => setFiles((fs) => [...fs, emptyFile()])}>+ 파일 추가</button>

      <div class="form-foot">
        <label class="checkbox"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite((e.target as HTMLInputElement).checked)} /> 덮어쓰기</label>
        <button type="submit" class="btn btn-primary" disabled={busy}>{busy ? '게시 중…' : '게시'}</button>
      </div>
    </form>
  );
}
