import { credentials } from '@grpc/grpc-js';
import { getBackendAddress } from '../backend/manager';
import {
  ProfileServiceClient,
  type CreateProfileRequest,
  type Profile,
  type ListProfilesRequest,
  type ListProfilesResponse,
  type GetProfileRequest,
  type UpdateProfileRequest,
  type DeleteProfileRequest,
} from '../gen/launcher/profile';
import {
  DownloadServiceClient,
  type ProgressRequest,
  type ProgressEvent,
  type DownloadRequest,
  type DownloadStarted,
  type DownloadCancel,
} from '../gen/launcher/download';
import {
  AssetServiceClient,
  type PrefetchAssetsRequest,
  type PrefetchAssetsResponse,
} from '../gen/launcher/asset';
import type { ClientReadableStream } from '@grpc/grpc-js';
import {
  InstanceServiceClient,
  type LogsRequest,
  type LogLine,
  type StateRequest,
  type StateEvent,
} from '../gen/launcher/instance';
import { HealthServiceClient, type HealthStatus } from '../gen/launcher/health';
import {
  SettingsServiceClient,
  type GetSettingsRequest,
  type GetSettingsResponse,
  type UpdateSettingsRequest,
  type UpdateSettingsResponse,
} from '../gen/launcher/settings';
import {
  VersionServiceClient,
  type ListMinecraftVersionsRequest,
  type ListMinecraftVersionsResponse,
  type ListLoaderVersionsRequest,
  type ListLoaderVersionsResponse,
  type CheckCompatibilityRequest,
  type CheckCompatibilityResponse,
} from '../gen/launcher/version';
import {
  LoaderServiceClient,
  type GetVersionsRequest as LoaderGetVersionsRequest,
  type GetVersionsResponse as LoaderGetVersionsResponse,
  type GetRecommendedRequest as LoaderGetRecommendedRequest,
  type GetRecommendedResponse as LoaderGetRecommendedResponse,
  type CheckInstalledRequest as LoaderCheckInstalledRequest,
  type CheckInstalledResponse as LoaderCheckInstalledResponse,
  type InstallRequest as LoaderInstallRequest,
  type InstallResponse as LoaderInstallResponse,
  type InstallProgress as LoaderInstallProgress,
} from '../gen/launcher/loader';
import {
  ModServiceClient,
  type ListModsRequest,
  type ListModsResponse,
  type ToggleModRequest,
  type ToggleModResponse,
  type RefreshModCacheRequest,
  type RefreshModCacheResponse,
} from '../gen/launcher/mod';
import {
  CacheServiceClient,
  type GetMinecraftVersionsRequest,
  type GetMinecraftVersionsResponse,
  type GetLatestMinecraftVersionRequest,
  type GetLatestMinecraftVersionResponse,
  type GetLoaderVersionsRequest,
  type GetLoaderVersionsResponse,
  type SearchModrinthRequest,
  type SearchModrinthResponse,
  type GetModrinthProjectRequest,
  type GetModrinthProjectResponse,
  type GetModrinthVersionsRequest,
  type GetModrinthVersionsResponse,
  type GetModrinthCategoriesRequest,
  type GetModrinthCategoriesResponse,
  type SearchCurseForgeRequest,
  type SearchCurseForgeResponse,
  type GetCurseForgeModRequest,
  type GetCurseForgeModResponse,
  type GetCurseForgeFilesRequest,
  type GetCurseForgeFilesResponse,
  type GetJavaInstallationsRequest,
  type GetJavaInstallationsResponse,
  type GetProfileStatsRequest,
  type GetProfileStatsResponse,
  type RecordProfileLaunchRequest,
  type RecordProfileLaunchResponse,
  type RecordProfilePlayTimeRequest,
  type RecordProfilePlayTimeResponse,
  type RecordProfileCrashRequest,
  type RecordProfileCrashResponse,
  type InvalidateCacheRequest,
  type InvalidateCacheResponse,
  type ClearExpiredCacheRequest,
  type ClearExpiredCacheResponse,
} from '../gen/launcher/cache';

let profileClient: ProfileServiceClient | null = null;
let downloadClient: DownloadServiceClient | null = null;
let instanceClient: InstanceServiceClient | null = null;
let healthClient: HealthServiceClient | null = null;
let versionClient: VersionServiceClient | null = null;
let loaderClient: LoaderServiceClient | null = null;
let lastAddr: string | null = null;
let assetClient: AssetServiceClient | null = null;
let settingsClient: SettingsServiceClient | null = null;
let modClient: ModServiceClient | null = null;
let cacheClient: CacheServiceClient | null = null;

function ensureAddr(): string {
  const addr = getBackendAddress();
  if (!addr) throw new Error('Backend server is not running');
  return addr;
}

function ensureSettingsClient(): SettingsServiceClient {
  const addr = ensureAddr();
  if (!settingsClient || lastAddr !== addr) {
    settingsClient = new SettingsServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return settingsClient;
}

function ensureAssetClient(): AssetServiceClient {
  const addr = ensureAddr();
  if (!assetClient || lastAddr !== addr) {
    assetClient = new AssetServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return assetClient;
}

function ensureLoaderClient(): LoaderServiceClient {
  const addr = ensureAddr();
  if (!loaderClient || lastAddr !== addr) {
    loaderClient = new LoaderServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return loaderClient;
}

function ensureHealthClient(): HealthServiceClient {
  const addr = ensureAddr();
  if (!healthClient || lastAddr !== addr) {
    healthClient = new HealthServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return healthClient;
}

function ensureVersionClient(): VersionServiceClient {
  const addr = ensureAddr();
  if (!versionClient || lastAddr !== addr) {
    versionClient = new VersionServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return versionClient;
}

export function streamState(
  req: StateRequest,
  onData: (ev: StateEvent) => void,
  onError?: (err: any) => void,
  onEnd?: () => void,
): () => void {
  const client = ensureInstanceClient();
  const stream: ClientReadableStream<StateEvent> = client.streamState(req);
  stream.on('data', onData);
  if (onError) stream.on('error', onError);
  if (onEnd) stream.on('end', onEnd);
  return () => {
    try { stream.cancel(); } catch {}
  };
}

export const settingsRpc = {
  getSettings: () =>
    promisify<GetSettingsRequest, GetSettingsResponse>(ensureSettingsClient().getSettings.bind(ensureSettingsClient()))({} as any),
  updateSettings: (req: UpdateSettingsRequest) =>
    promisify<UpdateSettingsRequest, UpdateSettingsResponse>(ensureSettingsClient().updateSettings.bind(ensureSettingsClient()))(req),
};

export const loaderRpc = {
  getVersions: (req: LoaderGetVersionsRequest) =>
    promisify<LoaderGetVersionsRequest, LoaderGetVersionsResponse>(ensureLoaderClient().getVersions.bind(ensureLoaderClient()))(req),
  getRecommended: (req: LoaderGetRecommendedRequest) =>
    promisify<LoaderGetRecommendedRequest, LoaderGetRecommendedResponse>(ensureLoaderClient().getRecommended.bind(ensureLoaderClient()))(req),
  checkInstalled: (req: LoaderCheckInstalledRequest) =>
    promisify<LoaderCheckInstalledRequest, LoaderCheckInstalledResponse>(ensureLoaderClient().checkInstalled.bind(ensureLoaderClient()))(req),
  install: (req: LoaderInstallRequest) =>
    promisify<LoaderInstallRequest, LoaderInstallResponse>(ensureLoaderClient().install.bind(ensureLoaderClient()))(req),
  streamInstall: (
    req: LoaderInstallRequest,
    onData: (ev: LoaderInstallProgress) => void,
    onError?: (err: any) => void,
    onEnd?: () => void,
  ): (() => void) => {
    const client = ensureLoaderClient();
    const stream: ClientReadableStream<LoaderInstallProgress> = (client as any).installStream(req);
    stream.on('data', onData);
    if (onError) stream.on('error', onError);
    if (onEnd) stream.on('end', onEnd);
    return () => {
      try { stream.cancel(); } catch {}
    };
  },
};

export const healthRpc = {
  check: () => promisify<any, HealthStatus>(
    (empty: any, cb: (err: any, res: HealthStatus) => void) => (ensureHealthClient() as any).check({}, cb as any)
  )({}),
};

export const downloadRpc = {
  publishProgress: (ev: ProgressEvent) =>
    promisify<ProgressEvent, { ok: boolean }>(ensureDownloadClient().publishProgress.bind(ensureDownloadClient()))(ev),
  streamProgress: (
    req: ProgressRequest,
    onData: (ev: ProgressEvent) => void,
    onError?: (err: any) => void,
    onEnd?: () => void,
  ): () => void => {
    const client = ensureDownloadClient();
    const stream: ClientReadableStream<ProgressEvent> = client.streamProgress(req);
    stream.on('data', onData);
    if (onError) stream.on('error', onError);
    if (onEnd) stream.on('end', onEnd);
    return () => { try { stream.cancel(); } catch {} };
  },
  startDownload: (req: DownloadRequest) =>
    promisify<DownloadRequest, DownloadStarted>(ensureDownloadClient().startDownload.bind(ensureDownloadClient()))(req),
  cancel: (req: DownloadCancel) =>
    promisify<DownloadCancel, { ok: boolean }>(ensureDownloadClient().cancel.bind(ensureDownloadClient()))(req),
};

export const instanceRpc = {
  publishLog: (line: LogLine) =>
    promisify<LogLine, { ok: boolean }>(ensureInstanceClient().publishLog.bind(ensureInstanceClient()))(line),
  publishState: (ev: StateEvent) =>
    promisify<StateEvent, { ok: boolean }>(ensureInstanceClient().publishState.bind(ensureInstanceClient()))(ev),
};

export const versionRpc = {
  listMinecraftVersions: (req: ListMinecraftVersionsRequest) =>
    promisify<ListMinecraftVersionsRequest, ListMinecraftVersionsResponse>(ensureVersionClient().listMinecraftVersions.bind(ensureVersionClient()))(req),
  listLoaderVersions: (req: ListLoaderVersionsRequest) =>
    promisify<ListLoaderVersionsRequest, ListLoaderVersionsResponse>(ensureVersionClient().listLoaderVersions.bind(ensureVersionClient()))(req),
  checkCompatibility: (req: CheckCompatibilityRequest) =>
    promisify<CheckCompatibilityRequest, CheckCompatibilityResponse>(ensureVersionClient().checkCompatibility.bind(ensureVersionClient()))(req),
};

export function streamLogs(
  req: LogsRequest,
  onData: (line: LogLine) => void,
  onError?: (err: any) => void,
  onEnd?: () => void,
): () => void {
  const client = ensureInstanceClient();
  const stream: ClientReadableStream<LogLine> = client.streamLogs(req);
  stream.on('data', onData);
  if (onError) stream.on('error', onError);
  if (onEnd) stream.on('end', onEnd);
  return () => {
    try { stream.cancel(); } catch {}
  };
}

function ensureProfileClient(): ProfileServiceClient {
  const addr = ensureAddr();
  if (!profileClient || lastAddr !== addr) {
    profileClient = new ProfileServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return profileClient;
}

function ensureDownloadClient(): DownloadServiceClient {
  const addr = ensureAddr();
  if (!downloadClient || lastAddr !== addr) {
    downloadClient = new DownloadServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return downloadClient;
}

function ensureInstanceClient(): InstanceServiceClient {
  const addr = ensureAddr();
  if (!instanceClient || lastAddr !== addr) {
    instanceClient = new InstanceServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return instanceClient;
}

function promisify<Req, Res>(
  fn: (req: Req, cb: (err: any, res: Res) => void) => any
): (req: Req) => Promise<Res> {
  return (req: Req) =>
    new Promise<Res>((resolve, reject) => {
      fn(req, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
}

export const profileRpc = {
  createProfile: (req: CreateProfileRequest) =>
    promisify<CreateProfileRequest, Profile>(ensureProfileClient().createProfile.bind(ensureProfileClient()))(req),
  listProfiles: (req: ListProfilesRequest) =>
    promisify<ListProfilesRequest, ListProfilesResponse>(ensureProfileClient().listProfiles.bind(ensureProfileClient()))(req),
  getProfile: (req: GetProfileRequest) =>
    promisify<GetProfileRequest, Profile>(ensureProfileClient().getProfile.bind(ensureProfileClient()))(req),
  updateProfile: (req: UpdateProfileRequest) =>
    promisify<UpdateProfileRequest, Profile>(ensureProfileClient().updateProfile.bind(ensureProfileClient()))(req),
  deleteProfile: (req: DeleteProfileRequest) =>
    promisify<DeleteProfileRequest, { success: boolean }>(ensureProfileClient().deleteProfile.bind(ensureProfileClient()))(req),
};

function ensureModClient(): ModServiceClient {
  const addr = ensureAddr();
  if (!modClient || lastAddr !== addr) {
    modClient = new ModServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return modClient;
}

export const modRpc = {
  listMods: (req: ListModsRequest) =>
    promisify<ListModsRequest, ListModsResponse>(ensureModClient().listMods.bind(ensureModClient()))(req),
  toggleMod: (req: ToggleModRequest) =>
    promisify<ToggleModRequest, ToggleModResponse>(ensureModClient().toggleMod.bind(ensureModClient()))(req),
  refreshModCache: (req: RefreshModCacheRequest) =>
    promisify<RefreshModCacheRequest, RefreshModCacheResponse>(ensureModClient().refreshModCache.bind(ensureModClient()))(req),
};

export function streamDownloadProgress(
  req: ProgressRequest,
  onData: (ev: ProgressEvent) => void,
  onError?: (err: any) => void,
  onEnd?: () => void,
): () => void {
  const client = ensureDownloadClient();
  const stream: ClientReadableStream<ProgressEvent> = client.streamProgress(req);
  stream.on('data', onData);
  if (onError) stream.on('error', onError);
  if (onEnd) stream.on('end', onEnd);
  return () => {
    try { stream.cancel(); } catch {}
  };
}

function ensureCacheClient(): CacheServiceClient {
  const addr = ensureAddr();
  if (!cacheClient || lastAddr !== addr) {
    cacheClient = new CacheServiceClient(addr, credentials.createInsecure());
    lastAddr = addr;
  }
  return cacheClient;
}

export const cacheRpc = {
  // Minecraft versions
  getMinecraftVersions: (req: GetMinecraftVersionsRequest) =>
    promisify<GetMinecraftVersionsRequest, GetMinecraftVersionsResponse>(
      ensureCacheClient().getMinecraftVersions.bind(ensureCacheClient())
    )(req),
  getLatestMinecraftVersion: (req: GetLatestMinecraftVersionRequest) =>
    promisify<GetLatestMinecraftVersionRequest, GetLatestMinecraftVersionResponse>(
      ensureCacheClient().getLatestMinecraftVersion.bind(ensureCacheClient())
    )(req),
  
  // Loader versions
  getFabricVersions: (req: GetLoaderVersionsRequest) =>
    promisify<GetLoaderVersionsRequest, GetLoaderVersionsResponse>(
      ensureCacheClient().getFabricVersions.bind(ensureCacheClient())
    )(req),
  getNeoForgeVersions: (req: GetLoaderVersionsRequest) =>
    promisify<GetLoaderVersionsRequest, GetLoaderVersionsResponse>(
      ensureCacheClient().getNeoForgeVersions.bind(ensureCacheClient())
    )(req),
  getQuiltVersions: (req: GetLoaderVersionsRequest) =>
    promisify<GetLoaderVersionsRequest, GetLoaderVersionsResponse>(
      ensureCacheClient().getQuiltVersions.bind(ensureCacheClient())
    )(req),
  
  // Modrinth API
  searchModrinthMods: (req: SearchModrinthRequest) =>
    promisify<SearchModrinthRequest, SearchModrinthResponse>(
      ensureCacheClient().searchModrinthMods.bind(ensureCacheClient())
    )(req),
  getModrinthProject: (req: GetModrinthProjectRequest) =>
    promisify<GetModrinthProjectRequest, GetModrinthProjectResponse>(
      ensureCacheClient().getModrinthProject.bind(ensureCacheClient())
    )(req),
  getModrinthVersions: (req: GetModrinthVersionsRequest) =>
    promisify<GetModrinthVersionsRequest, GetModrinthVersionsResponse>(
      ensureCacheClient().getModrinthVersions.bind(ensureCacheClient())
    )(req),
  getModrinthCategories: (req: GetModrinthCategoriesRequest) =>
    promisify<GetModrinthCategoriesRequest, GetModrinthCategoriesResponse>(
      ensureCacheClient().getModrinthCategories.bind(ensureCacheClient())
    )(req),
  
  // CurseForge API
  searchCurseForgeMods: (req: SearchCurseForgeRequest) =>
    promisify<SearchCurseForgeRequest, SearchCurseForgeResponse>(
      ensureCacheClient().searchCurseForgeMods.bind(ensureCacheClient())
    )(req),
  getCurseForgeMod: (req: GetCurseForgeModRequest) =>
    promisify<GetCurseForgeModRequest, GetCurseForgeModResponse>(
      ensureCacheClient().getCurseForgeMod.bind(ensureCacheClient())
    )(req),
  getCurseForgeFiles: (req: GetCurseForgeFilesRequest) =>
    promisify<GetCurseForgeFilesRequest, GetCurseForgeFilesResponse>(
      ensureCacheClient().getCurseForgeFiles.bind(ensureCacheClient())
    )(req),
  
  // Java installations
  getJavaInstallations: (req: GetJavaInstallationsRequest) =>
    promisify<GetJavaInstallationsRequest, GetJavaInstallationsResponse>(
      ensureCacheClient().getJavaInstallations.bind(ensureCacheClient())
    )(req),
  
  // Profile statistics
  getProfileStats: (req: GetProfileStatsRequest) =>
    promisify<GetProfileStatsRequest, GetProfileStatsResponse>(
      ensureCacheClient().getProfileStats.bind(ensureCacheClient())
    )(req),
  recordProfileLaunch: (req: RecordProfileLaunchRequest) =>
    promisify<RecordProfileLaunchRequest, RecordProfileLaunchResponse>(
      ensureCacheClient().recordProfileLaunch.bind(ensureCacheClient())
    )(req),
  recordProfilePlayTime: (req: RecordProfilePlayTimeRequest) =>
    promisify<RecordProfilePlayTimeRequest, RecordProfilePlayTimeResponse>(
      ensureCacheClient().recordProfilePlayTime.bind(ensureCacheClient())
    )(req),
  recordProfileCrash: (req: RecordProfileCrashRequest) =>
    promisify<RecordProfileCrashRequest, RecordProfileCrashResponse>(
      ensureCacheClient().recordProfileCrash.bind(ensureCacheClient())
    )(req),
  
  // Cache management
  invalidateCache: (req: InvalidateCacheRequest) =>
    promisify<InvalidateCacheRequest, InvalidateCacheResponse>(
      ensureCacheClient().invalidateCache.bind(ensureCacheClient())
    )(req),
  clearExpiredCache: (req: ClearExpiredCacheRequest) =>
    promisify<ClearExpiredCacheRequest, ClearExpiredCacheResponse>(
      ensureCacheClient().clearExpiredCache.bind(ensureCacheClient())
    )(req),
};
