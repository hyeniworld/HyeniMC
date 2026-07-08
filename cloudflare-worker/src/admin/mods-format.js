/** 순수 포맷 함수: sha256, ISO 시각, manifest 빌더. */

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 배포 스크립트(deploy-mod-v2.sh)의 manifest.json과 동일한 구조를 만든다.
 * latest.json은 이 결과의 바이트 동일 사본이다.
 */
export function buildManifest(meta) {
  const { modId, name, version, category, changelog, releaseDate, files } = meta;

  const loaders = {};
  for (const f of files) {
    if (!loaders[f.loader]) loaders[f.loader] = { gameVersions: {} };
    loaders[f.loader].gameVersions[f.gameVersion] = {
      file: f.fileName,
      sha256: f.sha256,
      size: f.size,
      minLoaderVersion: f.minLoaderVersion,
      maxLoaderVersion: f.maxLoaderVersion ?? null,
      downloadPath: `mods/${modId}/versions/${version}/${f.loader}/${f.gameVersion}/${f.fileName}`,
      dependencies: f.dependencies ?? {},
    };
  }

  const gameVersions = [...new Set(files.map((f) => f.gameVersion))];

  return {
    modId,
    name,
    version,
    releaseDate,
    changelog,
    gameVersions,
    loaders,
    category,
  };
}
