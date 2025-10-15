/**
 * Semaphore for controlling concurrent operations
 * Modrinth 앱의 Semaphore 방식을 참고하여 구현
 */
export class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * Acquire a permit. If no permits are available, waits until one is released.
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release a permit, allowing a waiting operation to proceed
   */
  release(): void {
    const resolve = this.queue.shift();
    if (resolve) {
      resolve();
    } else {
      this.permits++;
    }
  }

  /**
   * Execute a function with semaphore control
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get current available permits
   */
  availablePermits(): number {
    return this.permits;
  }

  /**
   * Get number of waiting tasks
   */
  queueLength(): number {
    return this.queue.length;
  }
}
