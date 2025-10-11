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
} from '../gen/launcher/download';
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

let profileClient: ProfileServiceClient | null = null;
let downloadClient: DownloadServiceClient | null = null;
let instanceClient: InstanceServiceClient | null = null;
let healthClient: HealthServiceClient | null = null;
let versionClient: VersionServiceClient | null = null;
let loaderClient: LoaderServiceClient | null = null;
let lastAddr: string | null = null;

function ensureAddr(): string {
  const addr = getBackendAddress();
  if (!addr) throw new Error('Backend server is not running');
  return addr;
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
