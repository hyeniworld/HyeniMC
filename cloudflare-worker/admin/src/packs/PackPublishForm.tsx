import { useState } from 'preact/hooks';
import * as api from '../api';
import { validatePackPublish } from '../lib/validate';
import { buildPackPublishForm } from '../lib/formdata';
import { sha256Hex } from '../lib/sha256';
import { parsePackMeta } from '../lib/packmeta';
import { Field } from '../components/Field';

// Worker 요청 본문 한도(무료 100MB) 근처는 멀티파트로 우회. 파트는 <100MB(여유 두어 80MB).
const MULTIPART_THRESHOLD = 90 * 1024 * 1024;
const PART_SIZE = 80 * 1024 * 1024;

export function PackPublishForm({ onToast, onPublished }: {
  onToast: (m: string, k?: 'ok' | 'err') => void; onPublished: () => void;
}) {
  const [pack, setPack] = useState<File | null>(null);
  const [sidecar, setSidecar] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  /** 90MB 초과 팩: R2 멀티파트 업로드(init → 순차 part → complete). */
  async function publishMultipart(sc: any, buffer: ArrayBuffer) {
    const { uploadId } = await api.packUploadInit(sc.hyenipackId, {
      version: sc.version, sha256: sc.sha256, overwrite,
    });
    const total = Math.ceil(pack!.size / PART_SIZE);
    const parts: api.UploadedPart[] = [];
    for (let i = 0; i < total; i++) {
      setProgress(`업로드 중 ${i + 1}/${total} 조각`);
      const blob = pack!.slice(i * PART_SIZE, (i + 1) * PART_SIZE);
      const part = await api.packUploadPart(sc.hyenipackId, uploadId, sc.version, i + 1, blob);
      parts.push({ partNumber: part.partNumber, etag: part.etag });
    }
    setProgress('마무리 중…');
    return await api.packUploadComplete(sc.hyenipackId, {
      uploadId, parts, latest: sc, packMeta: parsePackMeta(buffer),
    });
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!sidecar) { onToast('.latest.json 사이드카를 선택하세요.', 'err'); return; }
    let sc: any;
    try { sc = JSON.parse(await sidecar.text()); }
    catch { onToast('사이드카 JSON 파싱 실패', 'err'); return; }

    const errors = validatePackPublish({ pack, version: sc.version || '' });
    if (errors.length) { onToast(errors[0], 'err'); return; }

    // sha256 사전 검증(서버도 재검증하지만 조기 피드백)
    const buffer = await pack!.arrayBuffer();
    const actual = await sha256Hex(buffer);
    if (actual !== sc.sha256) {
      onToast(`sha256 불일치: 사이드카=${sc.sha256?.slice(0, 12)}… 실제=${actual.slice(0, 12)}…`, 'err');
      return;
    }

    setBusy(true);
    setProgress('');
    try {
      const res = pack!.size > MULTIPART_THRESHOLD
        ? await publishMultipart(sc, buffer)
        : await api.publishPack(sc.hyenipackId, buildPackPublishForm(pack!, sc), overwrite);
      onToast(`게시됨: ${res.id}@${res.version}`);
      onPublished();
    } catch (e: any) { onToast(e.message, 'err'); }
    finally { setBusy(false); setProgress(''); }
  }

  const big = !!pack && pack.size > MULTIPART_THRESHOLD;

  return (
    <form class="dialog-form-body" onSubmit={submit}>
      <p class="card-hint">런처 export 산출물(.hyenipack + 같은 이름의 .latest.json)을 선택하세요.</p>
      <div class="notice">기존 latest보다 높거나 같은 버전을 게시하면 latest가 됩니다(낮은 버전은 백필만).</div>
      {big && <div class="notice">90MB 초과 팩은 멀티파트로 조각 업로드됩니다.</div>}
      <div class="form-grid">
        <Field label=".hyenipack">
          <input type="file" accept=".hyenipack" onChange={(e) => setPack((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </Field>
        <Field label=".latest.json">
          <input type="file" accept=".json" onChange={(e) => setSidecar((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </Field>
      </div>
      <div class="form-foot">
        <label class="checkbox"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite((e.target as HTMLInputElement).checked)} /> 덮어쓰기</label>
        {busy && progress && <span class="card-hint">{progress}</span>}
        <button type="submit" class="btn btn-primary" disabled={busy}>{busy ? '게시 중…' : '게시'}</button>
      </div>
    </form>
  );
}
