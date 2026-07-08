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
 * 배포 스크립트(deploy-mod-v2.sh)의 manifest.json과 필드 구조·순서가 같도록 만든다.
 * (단, dependencies 미지정 시 이 함수는 `{}`를 내보내고 배포 스크립트는 `null`을 내보내는
 * 코너 케이스가 있어 완전한 바이트 동일은 아니다.)
 * latest.json은 이 결과의 바이트 동일 사본이다.
 */
export function buildManifest(meta) {
  const { modId, name, version, category, changelog, releaseDate, files } = meta;

  const loaders = {};
  // loader 키는 정렬 순(배포 스크립트의 sort -u와 일치)
  const loaderTypes = [...new Set(files.map((f) => f.loader))].sort();
  for (const loader of loaderTypes) {
    const gameVersions = {};
    // 각 로더의 gameVersions는 files 배열 등장 순서(배포 스크립트와 일치)
    for (const f of files.filter((x) => x.loader === loader)) {
      gameVersions[f.gameVersion] = {
        file: f.fileName,
        sha256: f.sha256,
        size: f.size,
        minLoaderVersion: f.minLoaderVersion,
        maxLoaderVersion: f.maxLoaderVersion ?? null,
        downloadPath: `mods/${modId}/versions/${version}/${loader}/${f.gameVersion}/${f.fileName}`,
        dependencies: f.dependencies ?? {},
      };
    }
    loaders[loader] = { gameVersions };
  }

  // top-level gameVersions: jq의 `unique`(정렬 후 dedup)와 동일하게 정렬
  const gameVersions = [...new Set(files.map((f) => f.gameVersion))].sort();

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
