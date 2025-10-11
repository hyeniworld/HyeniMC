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

let profileClient: ProfileServiceClient | null = null;
let downloadClient: DownloadServiceClient | null = null;
let lastAddr: string | null = null;

function ensureAddr(): string {
  const addr = getBackendAddress();
  if (!addr) throw new Error('Backend server is not running');
  return addr;
}

export const downloadRpc = {
  publishProgress: (ev: ProgressEvent) =>
    promisify<ProgressEvent, { ok: boolean }>(ensureDownloadClient().publishProgress.bind(ensureDownloadClient()))(ev),
};

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
