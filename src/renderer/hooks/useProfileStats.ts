import { useState, useEffect } from 'react';

export interface ProfileStats {
  profileId: string;
  lastLaunchedAt?: Date;
  totalPlayTime: number; // in seconds
  launchCount: number;
  crashCount: number;
  lastCrashAt?: Date;
}

/**
 * Hook to fetch and display profile statistics
 */
export function useProfileStats(profileId: string | null) {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) {
      setStats(null);
      return;
    }

    let cancelled = false;

    const fetchStats = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await window.electronAPI.profile.getStats(profileId);
        
        if (cancelled) return;

        if (result.stats) {
          setStats({
            profileId: result.stats.profileId,
            lastLaunchedAt: result.stats.lastLaunchedAt 
              ? new Date(result.stats.lastLaunchedAt * 1000) 
              : undefined,
            totalPlayTime: Number(result.stats.totalPlayTime) || 0,
            launchCount: result.stats.launchCount || 0,
            crashCount: result.stats.crashCount || 0,
            lastCrashAt: result.stats.lastCrashAt 
              ? new Date(result.stats.lastCrashAt * 1000) 
              : undefined,
          });
        } else {
          // No stats yet, return empty stats
          setStats({
            profileId,
            totalPlayTime: 0,
            launchCount: 0,
            crashCount: 0,
          });
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[useProfileStats] Failed to fetch stats:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch stats');
        // Set empty stats on error
        setStats({
          profileId,
          totalPlayTime: 0,
          launchCount: 0,
          crashCount: 0,
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  return { stats, loading, error };
}

/**
 * Format play time in human-readable format
 */
export function formatPlayTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}초`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}분`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (minutes > 0) {
      return `${hours}시간 ${minutes}분`;
    }
    return `${hours}시간`;
  }
}

/**
 * Format relative time (e.g., "5분 전", "2시간 전")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return '방금 전';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  } else if (diffHours < 24) {
    return `${diffHours}시간 전`;
  } else if (diffDays < 7) {
    return `${diffDays}일 전`;
  } else {
    // Format as date
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}
