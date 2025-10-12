import { Profile } from '../../shared/types/profile';

/**
 * 프로필 정렬 로직
 * 
 * 정렬 우선순위:
 * 1. 즐겨찾기 (favorite = true)
 * 2. 마지막 플레이 시간 (lastPlayed, 최신 우선)
 * 3. 생성 시간 (createdAt, 최신 우선)
 */
export function sortProfiles(profiles: Profile[]): Profile[] {
  return [...profiles].sort((a, b) => {
    // 1. 즐겨찾기 우선
    if (a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1;
    }

    // 2. 플레이한 프로필 우선
    const aHasPlayed = a.lastPlayed != null;
    const bHasPlayed = b.lastPlayed != null;

    if (aHasPlayed && bHasPlayed) {
      // 둘 다 플레이 기록 있음 → 최신 플레이 우선
      const aTime = new Date(a.lastPlayed!).getTime();
      const bTime = new Date(b.lastPlayed!).getTime();
      return bTime - aTime;
    }

    if (aHasPlayed !== bHasPlayed) {
      // 플레이 기록 있는 것 우선
      return aHasPlayed ? -1 : 1;
    }

    // 3. 둘 다 플레이 기록 없음 → createdAt 기준 (최신 우선)
    const aCreated = new Date(a.createdAt).getTime();
    const bCreated = new Date(b.createdAt).getTime();
    return bCreated - aCreated;
  });
}
