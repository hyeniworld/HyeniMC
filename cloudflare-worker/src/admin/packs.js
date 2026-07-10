/** 혜니팩 관리 핸들러. 공개 API가 읽는 modpacks/{id}/latest.json은 유지하고,
 * 버전 폴더에 스냅샷 latest.json을 추가로 저장해 롤백/편집을 지원한다. */
import { unzipSync } from 'fflate';
import { adminJson } from './router.js';
import { getJson, putJson, putObject, objectExists, listVersions, listPrefixes, deletePrefix, compareVersions } from './r2.js';
import { sha256Hex, isoNow } from './mods-format.js';

const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** URIError 없이 안전하게 디코딩한다. 잘못된 %-이스케이프는 null로 반환해 400 처리하도록 한다. */
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export async function handlePacks(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (method === 'GET' && path === '/admin/api/modpacks') {
    return await listPacks(env);
  }

  const versM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/versions$/);
  if (versM) {
    const id = safeDecode(versM[1]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    if (method === 'GET') return await listPackVersions(env, id);
    if (method === 'POST') return await publishPackVersion(request, env, id);
  }

  const latestM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/latest$/);
  if (latestM && method === 'PATCH') {
    const id = safeDecode(latestM[1]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    return await rollbackPack(request, env, id);
  }

  const visM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/visibility$/);
  if (visM && method === 'PATCH') {
    const id = safeDecode(visM[1]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    return await setPackVisibility(request, env, id);
  }

  // 대용량 팩 멀티파트 업로드(Worker 본문 한도 회피). 액션 세그먼트가 리터럴이라 버전 라우트와 disjoint.
  const upM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/versions\/(upload-init|upload-part|upload-complete)$/);
  if (upM) {
    const id = safeDecode(upM[1]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    const action = upM[2];
    if (action === 'upload-init' && method === 'POST') return await packUploadInit(request, env, id);
    if (action === 'upload-part' && method === 'PUT') return await packUploadPart(request, env, id);
    if (action === 'upload-complete' && method === 'POST') return await packUploadComplete(request, env, id);
  }

  const manM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/versions\/([^/]+)\/manifest$/);
  if (manM && method === 'GET') {
    const id = safeDecode(manM[1]);
    const ver = safeDecode(manM[2]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    if (ver === null || !VERSION_PATTERN.test(ver)) return adminJson({ error: 'Invalid version' }, 400);
    return await getPackVersionManifest(env, id, ver);
  }

  const verM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/versions\/([^/]+)$/);
  if (verM) {
    const id = safeDecode(verM[1]);
    const ver = safeDecode(verM[2]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    if (ver === null || !VERSION_PATTERN.test(ver)) return adminJson({ error: 'Invalid version' }, 400);
    if (method === 'PATCH') return await editPackVersion(request, env, id, ver);
    if (method === 'DELETE') return await deletePackVersion(env, id, ver);
  }

  return adminJson({ error: 'Not Found' }, 404);
}

/** .hyenipack(ZIP) 안의 hyenipack.json을 언집해 로더/게임버전/모드 목록을 노출한다.
 * sidecar latest.json에는 로더/모드 정보가 없어 팩 파일을 직접 파싱해야 한다. */
async function getPackVersionManifest(env, id, ver) {
  const obj = await env.RELEASES.get(`modpacks/${id}/versions/${ver}/pack.hyenipack`);
  if (!obj) return adminJson({ error: 'Not Found' }, 404);
  let manifest;
  try {
    const buf = new Uint8Array(await obj.arrayBuffer());
    const files = unzipSync(buf, { filter: (f) => f.name === 'hyenipack.json' });
    const entry = files['hyenipack.json'];
    if (!entry) return adminJson({ error: '.hyenipack에 hyenipack.json이 없습니다.' }, 422);
    manifest = JSON.parse(new TextDecoder().decode(entry));
  } catch (e) {
    return adminJson({ error: '.hyenipack 파싱 실패', message: e.message }, 500);
  }
  return adminJson({
    formatVersion: manifest.formatVersion ?? null,
    name: manifest.name ?? null,
    minecraft: manifest.minecraft ?? null,
    mods: Array.isArray(manifest.mods) ? manifest.mods : [],
  });
}

/** pack 바이너리(zip)에서 hyenipack.json 파싱. 실패/부재 시 null. */
function parsePackManifest(buffer) {
  try {
    const files = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === 'hyenipack.json' });
    const entry = files['hyenipack.json'];
    if (!entry) return null;
    return JSON.parse(new TextDecoder().decode(entry));
  } catch { return null; }
}

/** 목록 노출용 관용 파서: 팩 누락/엔트리 없음/JSON 오류 등 어떤 실패에도 null을 반환한다.
 * 팩 하나가 깨져도 전체 목록이 무너지지 않도록 상태 구분 없이 조용히 넘어간다. */
async function readPackManifest(env, id, ver) {
  const obj = await env.RELEASES.get(`modpacks/${id}/versions/${ver}/pack.hyenipack`);
  if (!obj) return null;
  return parsePackManifest(await obj.arrayBuffer());
}

/** meta.json 갱신 — name/minecraft는 대상 manifest 기준(없으면 기존/폴백), hidden은 항상 보존. */
async function upsertPackMeta(env, id, manifest) {
  const existing = await getJson(env, `modpacks/${id}/meta.json`);
  const meta = {
    name: manifest?.name ?? existing?.name ?? id,
    minecraft: manifest?.minecraft ?? existing?.minecraft ?? null,
    hidden: existing?.hidden ?? false,
    updatedAt: isoNow(),
  };
  await putJson(env, `modpacks/${id}/meta.json`, meta);
  return meta;
}

/** meta.json의 hidden만 토글한다. name/minecraft는 기존 meta에서 보존(없으면 폴백).
 * upsertPackMeta는 hidden 보존 전용이라 여기서는 쓰지 않고 직접 쓴다. */
async function setPackVisibility(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  if (typeof body.hidden !== 'boolean') return adminJson({ error: 'hidden(boolean)이 필요합니다.' }, 400);
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  if (!latest) return adminJson({ error: 'Not Found' }, 404);
  const existing = await getJson(env, `modpacks/${id}/meta.json`);
  await putJson(env, `modpacks/${id}/meta.json`, {
    name: existing?.name ?? id,
    minecraft: existing?.minecraft ?? null,
    hidden: body.hidden,
    updatedAt: isoNow(),
  });
  return adminJson({ id, hidden: body.hidden });
}

async function listPacks(env) {
  const ids = await listPrefixes(env, 'modpacks/');
  const packs = [];
  for (const id of ids) {
    const latest = await getJson(env, `modpacks/${id}/latest.json`);
    if (!latest) continue;
    const manifest = latest.version ? await readPackManifest(env, id, latest.version) : null;
    const meta = await getJson(env, `modpacks/${id}/meta.json`);
    packs.push({
      id,
      name: meta?.name ?? id,
      hidden: !!meta?.hidden,
      latestVersion: latest.version,
      breaking: !!latest.breaking,
      minecraft: manifest?.minecraft ?? null,
    });
  }
  return adminJson({ packs });
}

async function listPackVersions(env, id) {
  const versions = await listVersions(env, `modpacks/${id}/versions/`);
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  const detailed = [];
  for (const v of versions) {
    const snap = await getJson(env, `modpacks/${id}/versions/${v}/latest.json`);
    detailed.push({ version: v, changelog: snap?.changelog || '', breaking: !!snap?.breaking });
  }
  return adminJson({ id, latestVersion: latest?.version || null, versions: detailed });
}

/** 팩 바이너리가 packKey에 저장된 뒤의 공통 마무리: 스냅샷/조건부 공개 latest/meta.
 * manifest는 이미 파싱된 것을 받는다(null 허용 — 그 경우 meta는 기존/폴백 유지). */
async function finalizePackPublish(env, id, sidecar, manifest) {
  await putJson(env, `modpacks/${id}/versions/${sidecar.version}/latest.json`, sidecar);
  // 공개 latest(쿼리 미지정 구 클라이언트용 폴백)는 더 높거나 같은 버전일 때만 갱신.
  // 같은 버전(overwrite)은 내용 새로고침을 위해 갱신, 낮은 버전(백필)은 유지.
  const curLatest = await getJson(env, `modpacks/${id}/latest.json`);
  const isNewLatest = !curLatest?.version || compareVersions(sidecar.version, curLatest.version) >= 0;
  if (isNewLatest) {
    await putJson(env, `modpacks/${id}/latest.json`, sidecar);
  }
  if (isNewLatest || !(await getJson(env, `modpacks/${id}/meta.json`))) {
    await upsertPackMeta(env, id, manifest);
  }
}

async function publishPackVersion(request, env, id) {
  let form;
  try { form = await request.formData(); } catch { return adminJson({ error: 'multipart 본문 필요' }, 400); }

  const packPart = form.get('pack');
  if (!packPart || typeof packPart.arrayBuffer !== 'function') {
    return adminJson({ error: 'pack 파일 파트가 필요합니다.' }, 400);
  }
  const rawLatest = form.get('latest');
  if (typeof rawLatest !== 'string') {
    return adminJson({ error: 'latest 필드(JSON)가 필요합니다.' }, 400);
  }
  let sidecar;
  try { sidecar = JSON.parse(rawLatest); } catch {
    return adminJson({ error: 'latest 필드(JSON)가 필요합니다.' }, 400);
  }

  if (sidecar.hyenipackId !== id) return adminJson({ error: 'hyenipackId가 경로와 불일치합니다.' }, 400);
  if (!VERSION_PATTERN.test(sidecar.version || '')) return adminJson({ error: '버전 형식은 x.y.z' }, 400);

  const buffer = await packPart.arrayBuffer();
  const actual = await sha256Hex(buffer);
  if (actual !== sidecar.sha256) {
    return adminJson({ error: 'sha256 불일치', message: `expected ${sidecar.sha256}, got ${actual}` }, 400);
  }

  const overwrite = new URL(request.url).searchParams.get('overwrite') === 'true';
  const packKey = `modpacks/${id}/versions/${sidecar.version}/pack.hyenipack`;
  if (!overwrite && await objectExists(env, packKey)) {
    return adminJson({ error: '이미 존재하는 버전입니다.' }, 409);
  }

  await putObject(env, packKey, buffer, 'application/zip');
  // meta에 넘길 manifest 결정: 상위/동일 버전이면 이번 팩, 레거시(meta 부재) 하위 백필이면 공개 latest 팩.
  const curLatest = await getJson(env, `modpacks/${id}/latest.json`);
  const isNewLatest = !curLatest?.version || compareVersions(sidecar.version, curLatest.version) >= 0;
  let manifest = parsePackManifest(buffer);
  if (!isNewLatest && !(await getJson(env, `modpacks/${id}/meta.json`))) {
    manifest = (curLatest?.version ? await readPackManifest(env, id, curLatest.version) : null) ?? manifest;
  }
  await finalizePackPublish(env, id, sidecar, manifest);
  return adminJson({ id, version: sidecar.version, sha256: actual }, 201);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** R2 스트림을 메모리에 전부 올리지 않고 SHA-256 hex를 계산한다(128MB Worker 한도 회피). */
async function streamSha256Hex(stream) {
  const digestStream = new crypto.DigestStream('SHA-256');
  await stream.pipeTo(digestStream);
  const digest = await digestStream.digest;
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** (a) 멀티파트 업로드 시작: 버전/sha256 검증 + overwrite 아니면 중복 409 → uploadId 발급. */
async function packUploadInit(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  if (!VERSION_PATTERN.test(body.version || '')) return adminJson({ error: '버전 형식은 x.y.z' }, 400);
  if (!SHA256_HEX.test(body.sha256 || '')) return adminJson({ error: 'sha256(64자리 hex)이 필요합니다.' }, 400);

  const packKey = `modpacks/${id}/versions/${body.version}/pack.hyenipack`;
  if (body.overwrite !== true && await objectExists(env, packKey)) {
    return adminJson({ error: '이미 존재하는 버전입니다.' }, 409);
  }
  const upload = await env.RELEASES.createMultipartUpload(packKey);
  return adminJson({ uploadId: upload.uploadId, key: packKey });
}

/** (b) 파트 업로드: raw 바이너리 본문을 스트림으로 uploadPart에 전달(<100MB, 메모리 회피). */
async function packUploadPart(request, env, id) {
  const params = new URL(request.url).searchParams;
  const uploadId = params.get('uploadId');
  const version = params.get('version');
  const partNumber = Number(params.get('part'));
  if (!uploadId) return adminJson({ error: 'uploadId가 필요합니다.' }, 400);
  if (!VERSION_PATTERN.test(version || '')) return adminJson({ error: '버전 형식은 x.y.z' }, 400);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return adminJson({ error: 'part는 1~10000 정수여야 합니다.' }, 400);
  }
  if (!request.body) return adminJson({ error: '본문(바이너리)이 필요합니다.' }, 400);

  const packKey = `modpacks/${id}/versions/${version}/pack.hyenipack`;
  const upload = env.RELEASES.resumeMultipartUpload(packKey, uploadId);
  const part = await upload.uploadPart(partNumber, request.body);
  return adminJson({ partNumber: part.partNumber, etag: part.etag });
}

/** (c) 완료: 파트 병합 → 사후 스트리밍 sha256 검증(불일치 시 삭제+400) → 공통 마무리.
 * manifest(name/minecraft)는 클라이언트가 로컬 zip 파싱으로 동봉한 packMeta를 신뢰한다.
 * 완성 객체(100~150MB)를 Worker 메모리에 올려 unzip하면 128MB 한도 위험이 있어 서버 파싱을 피한다. */
async function packUploadComplete(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  const { uploadId, parts, latest: sidecar, packMeta } = body;

  if (!uploadId) return adminJson({ error: 'uploadId가 필요합니다.' }, 400);
  if (!Array.isArray(parts) || parts.length === 0 ||
      !parts.every((p) => Number.isInteger(p?.partNumber) && typeof p?.etag === 'string')) {
    return adminJson({ error: 'parts 배열(partNumber/etag)이 필요합니다.' }, 400);
  }
  if (!sidecar || typeof sidecar !== 'object') return adminJson({ error: 'latest(사이드카)가 필요합니다.' }, 400);
  if (sidecar.hyenipackId !== id) return adminJson({ error: 'hyenipackId가 경로와 불일치합니다.' }, 400);
  if (!VERSION_PATTERN.test(sidecar.version || '')) return adminJson({ error: '버전 형식은 x.y.z' }, 400);
  if (!SHA256_HEX.test(sidecar.sha256 || '')) return adminJson({ error: 'sha256(64자리 hex)이 필요합니다.' }, 400);

  const packKey = `modpacks/${id}/versions/${sidecar.version}/pack.hyenipack`;
  const upload = env.RELEASES.resumeMultipartUpload(packKey, uploadId);
  try {
    await upload.complete(parts);
  } catch (e) {
    return adminJson({ error: '멀티파트 완료 실패', message: e.message }, 400);
  }

  const obj = await env.RELEASES.get(packKey);
  if (!obj) return adminJson({ error: '완료된 객체를 찾을 수 없습니다.' }, 500);
  const actual = await streamSha256Hex(obj.body);
  if (actual !== sidecar.sha256) {
    await env.RELEASES.delete(packKey);
    return adminJson({ error: 'sha256 불일치', message: `expected ${sidecar.sha256}, got ${actual}` }, 400);
  }

  const manifest = packMeta && typeof packMeta === 'object'
    ? { name: packMeta.name ?? null, minecraft: packMeta.minecraft ?? null }
    : null;
  await finalizePackPublish(env, id, sidecar, manifest);
  return adminJson({ id, version: sidecar.version, sha256: actual }, 201);
}

async function rollbackPack(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  if (!VERSION_PATTERN.test(body.version || '')) return adminJson({ error: 'Invalid version' }, 400);

  const snap = await getJson(env, `modpacks/${id}/versions/${body.version}/latest.json`);
  if (!snap) return adminJson({ error: 'Not Found' }, 404);
  await putJson(env, `modpacks/${id}/latest.json`, snap);
  await upsertPackMeta(env, id, await readPackManifest(env, id, body.version));
  return adminJson({ id, latestVersion: body.version });
}

async function editPackVersion(request, env, id, ver) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }

  const snap = await getJson(env, `modpacks/${id}/versions/${ver}/latest.json`);
  if (!snap) return adminJson({ error: 'Not Found' }, 404);

  const updated = { ...snap };
  if (body.changelog !== undefined) updated.changelog = body.changelog;
  if (body.breaking !== undefined) updated.breaking = body.breaking;

  await putJson(env, `modpacks/${id}/versions/${ver}/latest.json`, updated);
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  if (latest && latest.version === ver) {
    await putJson(env, `modpacks/${id}/latest.json`, updated);
  }
  return adminJson({ id, version: ver });
}

async function deletePackVersion(env, id, ver) {
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  if (latest && latest.version === ver) {
    return adminJson({ error: '현재 latest 버전은 삭제할 수 없습니다. 먼저 롤백하세요.' }, 409);
  }
  const removed = await deletePrefix(env, `modpacks/${id}/versions/${ver}/`);
  if (removed === 0) return adminJson({ error: 'Not Found' }, 404);
  return adminJson({ id, deleted: ver, objects: removed });
}
