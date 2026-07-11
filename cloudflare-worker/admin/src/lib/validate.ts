// 모드: 정식 x.y.z 또는 프리릴리즈 x.y.z-(alpha|beta|pre)NNN(3자리). 팩은 x.y.z만(런처 export 산출물).
const MOD_VERSION = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|pre)\d{3})?$/;
const PACK_VERSION = /^\d+\.\d+\.\d+$/;
const LOADER = /^[a-z0-9]+$/;
const GAME_VERSION = /^\d+\.\d+(\.\d+)?$/;
const FILE_NAME = /^[A-Za-z0-9._+-]+\.jar$/;

export interface ModFileInput {
  loader: string; gameVersion: string; file: File | null; fileName: string;
  minLoaderVersion: string; maxLoaderVersion: string; dependencies: string;
}
export interface ModPublishInput {
  modId: string; name: string; version: string; category: string;
  changelog: string; files: ModFileInput[];
}

export function validateModPublish(input: ModPublishInput): string[] {
  const errors: string[] = [];
  if (!input.modId) errors.push('modId를 입력하세요.');
  if (!input.name) errors.push('name을 입력하세요.');
  if (!MOD_VERSION.test(input.version)) {
    errors.push('version은 x.y.z 또는 x.y.z-(alpha|beta|pre)NNN 형식이어야 합니다 (예: 1.2.3, 1.2.3-beta001).');
  }
  if (!input.category) errors.push('category를 입력하세요.');
  if (!input.files || input.files.length === 0) errors.push('파일을 1개 이상 추가하세요.');
  input.files?.forEach((f, i) => {
    const n = i + 1;
    if (!LOADER.test(f.loader)) errors.push(`파일 ${n}: loader 형식이 올바르지 않습니다.`);
    if (!GAME_VERSION.test(f.gameVersion)) errors.push(`파일 ${n}: gameVersion 형식이 올바르지 않습니다.`);
    if (!f.file) errors.push(`파일 ${n}: jar 파일을 선택하세요.`);
    if (!FILE_NAME.test(f.fileName)) errors.push(`파일 ${n}: 파일명은 .jar이어야 하고 경로문자를 포함할 수 없습니다.`);
    // minLoaderVersion은 선택 — 빈값 = 하한 없음(registry '0.0.0' 폴백, 런처 무제약). 편집 API의 min 빈값→null과 동일 규약.
    try { JSON.parse(f.dependencies || '{}'); } catch { errors.push(`파일 ${n}: dependencies가 유효한 JSON이 아닙니다.`); }
  });
  return errors;
}

export function validatePackPublish(input: { pack: File | null; version: string }): string[] {
  const errors: string[] = [];
  if (!input.pack) errors.push('.hyenipack 파일을 선택하세요.');
  if (!PACK_VERSION.test(input.version)) errors.push('version은 x.y.z 형식이어야 합니다.');
  return errors;
}

/** 프리릴리즈 버전(x.y.z-(alpha|beta|pre)NNN) 여부 — 핀 경고 등 UI 분기용. */
export function isPrerelease(version: string): boolean {
  return /-(?:alpha|beta|pre)\d{3}$/.test(version);
}
