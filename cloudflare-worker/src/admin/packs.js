/** 혜니팩 관리 핸들러. 공개 API가 읽는 modpacks/{id}/latest.json은 유지하고,
 * 버전 폴더에 스냅샷 latest.json을 추가로 저장해 롤백/편집을 지원한다. */
import { unzipSync } from 'fflate';
import { adminJson } from './router.js';
import { getJson, putJson, putObject, objectExists, listVersions, listPrefixes, deletePrefix, compareVersions } from './r2.js';
import { sha256Hex, isoNow } from './mods-format.js';

const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

// 팩 전체를 Worker 메모리에 올려 unzip하면 128MB 리소스 한도(Error 1102)를 넘긴다.
// 이 크기를 넘는 팩은 서버에서 파싱하지 않는다. name/minecraft는 meta.json에 이미 있으므로 목록/롤백은 영향 없음.
const SAFE_UNZIP_BYTES = 96 * 1024 * 1024;

// 사후 sha256 재검증은 팩 전체를 스트리밍 해시한다. 대용량은 Worker 요청당 리소스 한도(메모리 128MB/CPU, Error 1102)를
// 넘길 수 있어(102MB는 통과·144MB는 실패 관측), 이 크기 이하만 서버에서 재검증하고 그 이상은
// 클라이언트 업로드 전 sha256 검증 + R2 파트 etag 무결성에 맡긴다.
const SAFE_HASH_BYTES = 80 * 1024 * 1024;

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

/** 버전 상세(로더/게임버전/모드 목록)를 노출한다.
 * 게시 때 저장한 사이드카 manifest.json이 있으면 그걸 반환(팩을 서버에서 unzip하지 않아 대용량 안전).
 * 사이드카가 없는 레거시 버전만 소형 팩에 한해 직접 unzip 폴백한다(대용량은 128MB 한도라 413). */
async function getPackVersionManifest(env, id, ver) {
  const sidecar = await getJson(env, `modpacks/${id}/versions/${ver}/manifest.json`);
  if (sidecar) {
    return adminJson({
      formatVersion: sidecar.formatVersion ?? null,
      name: sidecar.name ?? null,
      minecraft: sidecar.minecraft ?? null,
      mods: Array.isArray(sidecar.mods) ? sidecar.mods : [],
    });
  }

  const obj = await env.RELEASES.get(`modpacks/${id}/versions/${ver}/pack.hyenipack`);
  if (!obj) return adminJson({ error: 'Not Found' }, 404);
  // 사이드카 없는 레거시: 대용량 팩을 arrayBuffer로 올리면 Worker 128MB 한도 초과(Error 1102). 사전 차단.
  if (obj.size > SAFE_UNZIP_BYTES) {
    return adminJson({
      error: '팩이 너무 커서 서버에서 매니페스트(모드 목록)를 파싱할 수 없습니다. 해당 버전을 다시 게시하면 사이드카가 생성되어 조회됩니다.',
      oversized: true,
      size: obj.size,
    }, 413);
  }
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

/** readPackManifest의 메모리 안전판: 대용량 팩(>SAFE_UNZIP_BYTES)은 파싱하지 않고 null을 반환한다.
 * 팩 전체를 arrayBuffer로 올리면 Worker 128MB 한도 초과 → Error 1102(503)가 나므로 head로 먼저 크기를 본다. */
async function readPackManifestSafe(env, id, ver) {
  const head = await env.RELEASES.head(`modpacks/${id}/versions/${ver}/pack.hyenipack`);
  if (!head || head.size > SAFE_UNZIP_BYTES) return null;
  return readPackManifest(env, id, ver);
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
    const meta = await getJson(env, `modpacks/${id}/meta.json`);
    // minecraft는 meta.json이 정본. meta에 없을 때만(레거시 팩) 팩에서 파싱하되,
    // 대용량 팩은 readPackManifestSafe가 건너뛴다(128MB 한도 초과 → 목록 전체 503 방지).
    let minecraft = meta?.minecraft ?? null;
    if (minecraft == null && latest.version) {
      minecraft = (await readPackManifestSafe(env, id, latest.version))?.minecraft ?? null;
    }
    packs.push({
      id,
      name: meta?.name ?? id,
      hidden: !!meta?.hidden,
      latestVersion: latest.version,
      breaking: !!latest.breaking,
      minecraft,
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

/** 버전 상세(모드 목록)용 사이드카 manifest.json 저장. 조회 시 팩을 서버에서 unzip하지 않게 한다.
 * manifest는 해당 버전 팩의 hyenipack.json(단일 경로=서버 파싱, 멀티파트=클라 packMeta). null이면 저장하지 않음. */
async function writeVersionManifest(env, id, ver, manifest) {
  if (!manifest || typeof manifest !== 'object') return;
  await putJson(env, `modpacks/${id}/versions/${ver}/manifest.json`, {
    formatVersion: manifest.formatVersion ?? null,
    name: manifest.name ?? null,
    minecraft: manifest.minecraft ?? null,
    mods: Array.isArray(manifest.mods) ? manifest.mods : [],
  });
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
  // 이 버전 팩 자체의 매니페스트로 버전 상세용 사이드카를 저장(조회 시 팩 재-unzip 방지).
  const ownManifest = parsePackManifest(buffer);
  await writeVersionManifest(env, id, sidecar.version, ownManifest);
  // meta에 넘길 manifest 결정: 상위/동일 버전이면 이번 팩, 레거시(meta 부재) 하위 백필이면 공개 latest 팩.
  const curLatest = await getJson(env, `modpacks/${id}/latest.json`);
  const isNewLatest = !curLatest?.version || compareVersions(sidecar.version, curLatest.version) >= 0;
  let manifest = ownManifest;
  if (!isNewLatest && !(await getJson(env, `modpacks/${id}/meta.json`))) {
    manifest = (curLatest?.version ? await readPackManifest(env, id, curLatest.version) : null) ?? ownManifest;
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

/** (c) 완료: 파트 병합 → (소형만) 사후 스트리밍 sha256 검증 → 버전 사이드카/공통 마무리.
 * 대용량 팩은 사후 재해시가 Worker 리소스 한도(1102)를 넘기므로 스킵하고 클라 사전검증+R2 파트 무결성을 신뢰한다.
 * manifest(name/minecraft/mods)는 클라이언트가 로컬 zip 파싱으로 동봉한 packMeta를 신뢰한다(서버 대용량 unzip 회피). */
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
  // 소형 팩만 사후 재검증. 대용량은 팩 전체 해시가 Worker 리소스 한도(1102)를 넘기므로 스킵
  // (클라이언트가 업로드 전 sha256을 검증했고, complete()가 파트 etag로 조립 무결성을 보장한다).
  // get()은 메타데이터만 받고 body는 소형일 때만 소비하므로 대용량이어도 여기서 안전하다.
  if (obj.size <= SAFE_HASH_BYTES) {
    const actual = await streamSha256Hex(obj.body);
    if (actual !== sidecar.sha256) {
      await env.RELEASES.delete(packKey);
      return adminJson({ error: 'sha256 불일치', message: `expected ${sidecar.sha256}, got ${actual}` }, 400);
    }
  }

  const manifest = packMeta && typeof packMeta === 'object'
    ? {
        formatVersion: packMeta.formatVersion ?? null,
        name: packMeta.name ?? null,
        minecraft: packMeta.minecraft ?? null,
        mods: Array.isArray(packMeta.mods) ? packMeta.mods : [],
      }
    : null;
  await writeVersionManifest(env, id, sidecar.version, manifest);
  await finalizePackPublish(env, id, sidecar, manifest);
  return adminJson({ id, version: sidecar.version, sha256: sidecar.sha256 }, 201);
}

async function rollbackPack(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  if (!VERSION_PATTERN.test(body.version || '')) return adminJson({ error: 'Invalid version' }, 400);

  const snap = await getJson(env, `modpacks/${id}/versions/${body.version}/latest.json`);
  if (!snap) return adminJson({ error: 'Not Found' }, 404);
  await putJson(env, `modpacks/${id}/latest.json`, snap);
  // 롤백 대상 팩이 대용량이면 파싱을 건너뛴다(128MB 한도). 그 경우 name/minecraft는 기존 meta 유지.
  await upsertPackMeta(env, id, await readPackManifestSafe(env, id, body.version));
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
