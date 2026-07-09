import { useState } from 'preact/hooks';
import * as api from '../api';
import { validateModPublish, type ModFileInput } from '../lib/validate';
import { buildModPublishForm } from '../lib/formdata';
import { Field } from '../components/Field';

const emptyFile = (): ModFileInput => ({
  loader: 'neoforge', gameVersion: '1.21.1', file: null, fileName: '',
  minLoaderVersion: '', maxLoaderVersion: '', dependencies: '{}',
});

export function ModPublishForm({ onToast, onPublished }: {
  onToast: (m: string, k?: 'ok' | 'err') => void; onPublished: () => void;
}) {
  const [modId, setModId] = useState('');
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
        minLoaderVersion: f.minLoaderVersion,
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
    <form onSubmit={submit}>
      <h3>새 모드 버전 게시</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        <Field label="modId"><input value={modId} onInput={(e) => setModId((e.target as HTMLInputElement).value)} /></Field>
        <Field label="name"><input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field label="version (x.y.z)"><input value={version} onInput={(e) => setVersion((e.target as HTMLInputElement).value)} /></Field>
        <Field label="category">
          <select value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>
            <option value="required">required</option>
            <option value="optional">optional</option>
          </select>
        </Field>
      </div>
      <Field label="changelog"><textarea value={changelog} onInput={(e) => setChangelog((e.target as HTMLTextAreaElement).value)} /></Field>

      <h4>파일</h4>
      {files.map((f, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr) auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
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
          <button type="button" disabled={files.length === 1} onClick={() => setFiles((fs) => fs.filter((_, idx) => idx !== i))}>삭제</button>
        </div>
      ))}
      <button type="button" onClick={() => setFiles((fs) => [...fs, emptyFile()])}>+ 파일 추가</button>

      <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite((e.target as HTMLInputElement).checked)} /> 덮어쓰기</label>
        <button type="submit" disabled={busy}>{busy ? '게시 중…' : '게시'}</button>
      </div>
    </form>
  );
}
