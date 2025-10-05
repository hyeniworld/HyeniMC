/**
 * 다운로드 관련 타입 정의
 */

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DownloadTask {
  id: string;
  type: 'mod' | 'modpack' | 'minecraft' | 'loader' | 'java' | 'asset';
  name: string;
  url: string;
  destination: string;
  
  status: DownloadStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  
  sha1?: string;
  sha512?: string;
  
  error?: string;
  retryCount: number;
  maxRetries: number;
  
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface DownloadConfig {
  maxConcurrent: number;
  threadsPerDownload: number;
  retryAttempts: number;
  timeout: number;
}

export interface CreateDownloadTask {
  name: string;
  url: string;
  destination: string;
  checksum?: { algorithm: 'sha1' | 'sha512'; hash: string };
  headers?: Record<string, string>;
}

export interface DownloadBatchResult {
  completed: DownloadTask[];
  failed: Array<{ task: DownloadTask; error: string }>;
}

export type ProgressCallback = (progress: number, downloadedBytes: number, totalBytes: number) => void;
export type BatchProgressCallback = (completed: number, total: number, currentTask: DownloadTask) => void;
