import axios, { AxiosProgressEvent } from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface DownloadTask {
  id: string;
  url: string;
  destination: string;
  size?: number;
  checksum?: string;
  checksumType?: 'sha1' | 'sha256';
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

export interface DownloadProgress {
  taskId: string;
  downloaded: number;
  total: number;
  progress: number;
  speed: number;
  // Overall progress
  completedTasks?: number;
  totalTasks?: number;
  overallProgress?: number;
}

type ProgressCallback = (progress: DownloadProgress) => void;

export class DownloadManager {
  private tasks: Map<string, DownloadTask> = new Map();
  private activeTasks: Set<string> = new Set();
  private maxConcurrent: number;
  private progressCallbacks: Map<string, ProgressCallback> = new Map();

  constructor(maxConcurrent: number = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Add a download task
   */
  addTask(
    url: string,
    destination: string,
    checksum?: string,
    checksumType: 'sha1' | 'sha256' = 'sha1'
  ): string {
    const id = crypto.randomUUID();
    const task: DownloadTask = {
      id,
      url,
      destination,
      checksum,
      checksumType,
      progress: 0,
      status: 'pending',
    };

    this.tasks.set(id, task);
    return id;
  }

  /**
   * Start downloading all pending tasks
   */
  async startAll(onProgress?: ProgressCallback): Promise<void> {
    const pendingTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'pending'
    );

    const totalTasks = pendingTasks.length;
    // Track which tasks we're downloading in this batch
    const taskIds = new Set(pendingTasks.map(t => t.id));

    const chunks: DownloadTask[][] = [];
    for (let i = 0; i < pendingTasks.length; i += this.maxConcurrent) {
      chunks.push(pendingTasks.slice(i, i + this.maxConcurrent));
    }

    // Wrap progress callback to include overall progress
    const wrappedCallback: ProgressCallback | undefined = onProgress
      ? (progress) => {
          // Only count tasks from this batch that are completed
          const completed = Array.from(this.tasks.values()).filter(
            (t) => taskIds.has(t.id) && t.status === 'completed'
          ).length;
          
          onProgress({
            ...progress,
            completedTasks: completed,
            totalTasks,
            overallProgress: totalTasks > 0 ? (completed / totalTasks) * 100 : 0,
          });
        }
      : undefined;

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map((task) => this.downloadTask(task, wrappedCallback))
      );
    }
  }

  /**
   * Download a single task
   */
  private async downloadTask(
    task: DownloadTask,
    onProgress?: ProgressCallback,
    maxRetries: number = 3
  ): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        task.status = 'downloading';
        this.activeTasks.add(task.id);

        // Ensure directory exists
        await fs.mkdir(path.dirname(task.destination), { recursive: true });

        // Check if file already exists with correct checksum
        if (task.checksum && (await this.verifyChecksum(task.destination, task.checksum, task.checksumType))) {
          console.log(`[Download] File already exists with correct checksum: ${task.destination}`);
          task.progress = 100;
          task.status = 'completed';
          this.activeTasks.delete(task.id);
          return;
        }
        
        // Attempt download
        await this.performDownload(task, onProgress);
        
        // Verify checksum
        if (task.checksum) {
          const valid = await this.verifyChecksum(
            task.destination,
            task.checksum,
            task.checksumType
          );

          if (!valid) {
            throw new Error('Checksum verification failed');
          }
        }

        task.progress = 100;
        task.status = 'completed';
        this.activeTasks.delete(task.id);
        return;
      } catch (error) {
        lastError = error as Error;
        console.error(`[Download] Attempt ${attempt + 1}/${maxRetries} failed for ${task.url}:`, error);
        
        if (attempt < maxRetries - 1) {
          // Wait before retry (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.log(`[Download] Retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // All retries failed
    task.status = 'failed';
    task.error = lastError?.message || 'Unknown error';
    this.activeTasks.delete(task.id);
    throw lastError;
  }
  
  /**
   * Perform the actual download
   */
  private async performDownload(
    task: DownloadTask,
    onProgress?: ProgressCallback
  ): Promise<void> {
    // Download file
    let lastUpdate = Date.now();
    let lastLoaded = 0;

    const response = await axios({
      method: 'GET',
      url: task.url,
      responseType: 'stream',
      onDownloadProgress: (progressEvent: AxiosProgressEvent) => {
        const now = Date.now();
        const timeDiff = (now - lastUpdate) / 1000;
        const loaded = progressEvent.loaded || 0;
        const total = progressEvent.total || 0;
        const loadedDiff = loaded - lastLoaded;

        if (timeDiff >= 0.5) {
          // Update every 0.5 seconds
          const speed = loadedDiff / timeDiff;
          const progress = total > 0 ? (loaded / total) * 100 : 0;

          task.progress = progress;

          if (onProgress) {
            onProgress({
              taskId: task.id,
              downloaded: loaded,
              total,
              progress,
              speed,
            });
          }

          lastUpdate = now;
          lastLoaded = loaded;
        }
      },
    });

    // Write to file
    const writer = await fs.open(task.destination, 'w');
    const stream = response.data;

    for await (const chunk of stream) {
      await writer.write(chunk);
    }

    await writer.close();
  }

  /**
   * Verify file checksum
   */
  private async verifyChecksum(
    filePath: string,
    expectedChecksum: string,
    type: 'sha1' | 'sha256' = 'sha1'
  ): Promise<boolean> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const hash = crypto.createHash(type);
      hash.update(fileBuffer);
      const actualChecksum = hash.digest('hex');

      return actualChecksum.toLowerCase() === expectedChecksum.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Get task by ID
   */
  getTask(id: string): DownloadTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get active tasks count
   */
  getActiveCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(): void {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed') {
        this.tasks.delete(id);
      }
    }
  }

  /**
   * Clear all tasks
   */
  clearAll(): void {
    this.tasks.clear();
    this.activeTasks.clear();
  }
}
