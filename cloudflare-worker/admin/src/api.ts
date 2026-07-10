export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const BASE = '/admin/api';

async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, body.error || `요청 실패 (${res.status})`);
  }
  return body;
}

const json = (method: string, obj: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj),
});

// mods
export const listMods = () => req('/mods');
export const listModVersions = (id: string) => req(`/mods/${id}/versions`);
export const publishMod = (id: string, fd: FormData, overwrite = false) =>
  req(`/mods/${id}/versions${overwrite ? '?overwrite=true' : ''}`, { method: 'POST', body: fd });
export const rollbackMod = (id: string, version: string) =>
  req(`/mods/${id}/latest`, json('PATCH', { version }));
export const editModVersion = (id: string, ver: string, patch: object) =>
  req(`/mods/${id}/versions/${ver}`, json('PATCH', patch));
export const deleteModVersion = (id: string, ver: string) =>
  req(`/mods/${id}/versions/${ver}`, { method: 'DELETE' });
export const getModIndex = (id: string) => req(`/mods/${id}/index`);
export const setModPin = (id: string, patch: { loader: string; gameVersion: string; version: string | null }) =>
  req(`/mods/${id}/pins`, json('PATCH', patch));

// modpacks
export const listPacks = () => req('/modpacks');
export const listPackVersions = (id: string) => req(`/modpacks/${id}/versions`);
export const getPackManifest = (id: string, ver: string) => req(`/modpacks/${id}/versions/${ver}/manifest`);
export const publishPack = (id: string, fd: FormData, overwrite = false) =>
  req(`/modpacks/${id}/versions${overwrite ? '?overwrite=true' : ''}`, { method: 'POST', body: fd });
export const rollbackPack = (id: string, version: string) =>
  req(`/modpacks/${id}/latest`, json('PATCH', { version }));
export const editPackVersion = (id: string, ver: string, patch: object) =>
  req(`/modpacks/${id}/versions/${ver}`, json('PATCH', patch));
export const deletePackVersion = (id: string, ver: string) =>
  req(`/modpacks/${id}/versions/${ver}`, { method: 'DELETE' });
export const setPackVisibility = (id: string, hidden: boolean) =>
  req(`/modpacks/${id}/visibility`, json('PATCH', { hidden }));

// modpacks: 대용량 멀티파트 업로드(Worker 본문 한도 회피)
export interface UploadedPart { partNumber: number; etag: string; }
export const packUploadInit = (id: string, body: { version: string; sha256: string; overwrite?: boolean }) =>
  req(`/modpacks/${id}/versions/upload-init`, json('POST', body)) as Promise<{ uploadId: string; key: string }>;
export const packUploadPart = (id: string, uploadId: string, version: string, partNumber: number, blob: Blob) => {
  const qs = new URLSearchParams({ uploadId, version, part: String(partNumber) });
  return req(`/modpacks/${id}/versions/upload-part?${qs}`, { method: 'PUT', body: blob }) as Promise<UploadedPart>;
};
export const packUploadComplete = (id: string, body: {
  uploadId: string; parts: UploadedPart[]; latest: unknown; packMeta?: { name?: string; minecraft?: unknown };
}) => req(`/modpacks/${id}/versions/upload-complete`, json('POST', body));

// registry
export const rebuildRegistry = () => req('/registry/rebuild', { method: 'POST' });
