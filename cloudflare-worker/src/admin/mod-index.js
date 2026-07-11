/** 모드 인덱스: (loader,gameVersion)별 해석 latest(auto/pinned)를 계산·저장한다. */
import { getJson, putJson, listVersions, compareVersions, isPrerelease } from './r2.js';
import { isoNow } from './mods-format.js';

/** 모든 버전 manifest를 스캔해 (loader,gv)별 auto(최고버전) 계산 + 기존 pinned 보존. */
export async function rebuildModIndex(env, id) {
  const versionIds = await listVersions(env, `mods/${id}/versions/`);
  const offers = {}; // loader -> gv -> [versions]
  for (const v of versionIds) {
    const manifest = await getJson(env, `mods/${id}/versions/${v}/manifest.json`);
    if (!manifest || !manifest.loaders) continue;
    for (const [loader, ldata] of Object.entries(manifest.loaders)) {
      for (const gv of Object.keys(ldata.gameVersions || {})) {
        offers[loader] ??= {};
        offers[loader][gv] ??= [];
        offers[loader][gv].push(v);
      }
    }
  }

  const existing = await getJson(env, `mods/${id}/index.json`);
  const existingTargets = existing?.targets || {};

  const targets = {};
  for (const [loader, gvs] of Object.entries(offers)) {
    targets[loader] = {};
    for (const [gv, versions] of Object.entries(gvs)) {
      // 프리릴리즈는 auto(자동 최신)에서 제외 — 일반 사용자에게 자동 배포되지 않도록. 노출은 핀으로만.
      const stable = versions.filter((v) => !isPrerelease(v));
      const auto = stable.length ? [...stable].sort(compareVersions).at(-1) : null;
      const prevPinned = existingTargets[loader]?.[gv]?.pinned ?? null;
      const pinned = prevPinned && versions.includes(prevPinned) ? prevPinned : null;
      targets[loader][gv] = { auto, pinned };
    }
  }

  const index = { version: '1', updatedAt: isoNow(), targets };
  await putJson(env, `mods/${id}/index.json`, index);
  return index;
}

/** (loader,gameVersion) 해석 버전. pinned ?? auto, 없으면 null. */
export function resolveFromIndex(index, loader, gameVersion) {
  const c = index?.targets?.[loader]?.[gameVersion];
  if (!c) return null;
  return c.pinned ?? c.auto ?? null;
}

/** 핀 설정/해제. version=null이면 해제. version이 그 타깃을 제공하는지 검증. */
export async function setModPin(env, id, loader, gameVersion, version) {
  const index = await getJson(env, `mods/${id}/index.json`);
  if (!index?.targets?.[loader]?.[gameVersion]) {
    return { ok: false, error: '존재하지 않는 (로더,게임버전) 타깃입니다.' };
  }
  if (version !== null) {
    const manifest = await getJson(env, `mods/${id}/versions/${version}/manifest.json`);
    if (!manifest?.loaders?.[loader]?.gameVersions?.[gameVersion]) {
      return { ok: false, error: '그 버전은 해당 로더/게임버전 타깃이 없습니다.' };
    }
  }
  index.targets[loader][gameVersion].pinned = version;
  index.updatedAt = isoNow();
  await putJson(env, `mods/${id}/index.json`, index);
  return { ok: true, index };
}
