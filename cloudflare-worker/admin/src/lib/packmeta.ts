import { unzipSync } from 'fflate';

export interface PackMeta { formatVersion?: unknown; name?: string; minecraft?: unknown; mods?: unknown[] }

/** .hyenipack(zip) 버퍼에서 hyenipack.json을 추출해 formatVersion/name/minecraft/mods를 반환. 실패/부재 시 undefined.
 * 서버는 대용량 객체를 메모리에 올려 파싱하지 않으므로(128MB 한도), 클라이언트가 미리 파싱해 동봉한다.
 * mods까지 담아 게시 때 버전 상세용 사이드카 manifest.json에 저장한다(대용량 팩도 상세 조회 가능). */
export function parsePackMeta(buffer: ArrayBuffer): PackMeta | undefined {
  try {
    const files = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === 'hyenipack.json' });
    const entry = files['hyenipack.json'];
    if (!entry) return undefined;
    const manifest = JSON.parse(new TextDecoder().decode(entry));
    return {
      formatVersion: manifest.formatVersion,
      name: manifest.name,
      minecraft: manifest.minecraft,
      mods: Array.isArray(manifest.mods) ? manifest.mods : [],
    };
  } catch {
    return undefined;
  }
}
