import { unzipSync } from 'fflate';

export interface PackMeta { name?: string; minecraft?: unknown }

/** .hyenipack(zip) 버퍼에서 hyenipack.json의 name/minecraft만 추출. 실패/부재 시 undefined.
 * 서버는 대용량 객체를 메모리에 올려 파싱하지 않으므로(128MB 한도), 클라이언트가 미리 파싱해 동봉한다. */
export function parsePackMeta(buffer: ArrayBuffer): PackMeta | undefined {
  try {
    const files = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === 'hyenipack.json' });
    const entry = files['hyenipack.json'];
    if (!entry) return undefined;
    const manifest = JSON.parse(new TextDecoder().decode(entry));
    return { name: manifest.name, minecraft: manifest.minecraft };
  } catch {
    return undefined;
  }
}
