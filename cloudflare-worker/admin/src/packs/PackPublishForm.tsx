import { useState } from 'preact/hooks';
import * as api from '../api';
import { validatePackPublish } from '../lib/validate';
import { buildPackPublishForm } from '../lib/formdata';
import { sha256Hex } from '../lib/sha256';
import { Field } from '../components/Field';

export function PackPublishForm({ onToast, onPublished }: {
  onToast: (m: string, k?: 'ok' | 'err') => void; onPublished: () => void;
}) {
  const [pack, setPack] = useState<File | null>(null);
  const [sidecar, setSidecar] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!sidecar) { onToast('.latest.json 사이드카를 선택하세요.', 'err'); return; }
    let sc: any;
    try { sc = JSON.parse(await sidecar.text()); }
    catch { onToast('사이드카 JSON 파싱 실패', 'err'); return; }

    const errors = validatePackPublish({ pack, version: sc.version || '' });
    if (errors.length) { onToast(errors[0], 'err'); return; }

    // sha256 사전 검증(서버도 재검증하지만 조기 피드백)
    const actual = await sha256Hex(await pack!.arrayBuffer());
    if (actual !== sc.sha256) {
      onToast(`sha256 불일치: 사이드카=${sc.sha256?.slice(0, 12)}… 실제=${actual.slice(0, 12)}…`, 'err');
      return;
    }

    setBusy(true);
    try {
      const res = await api.publishPack(sc.hyenipackId, buildPackPublishForm(pack!, sc), overwrite);
      onToast(`게시됨: ${res.id}@${res.version}`);
      onPublished();
    } catch (e: any) { onToast(e.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <h3>새 혜니팩 버전 게시</h3>
      <p style={{ color: '#777', fontSize: 13 }}>런처 export 산출물(.hyenipack + 같은 이름의 .latest.json)을 선택하세요.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label=".hyenipack">
          <input type="file" accept=".hyenipack" onChange={(e) => setPack((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </Field>
        <Field label=".latest.json">
          <input type="file" accept=".json" onChange={(e) => setSidecar((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </Field>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite((e.target as HTMLInputElement).checked)} /> 덮어쓰기</label>
        <button type="submit" disabled={busy}>{busy ? '게시 중…' : '게시'}</button>
      </div>
    </form>
  );
}
