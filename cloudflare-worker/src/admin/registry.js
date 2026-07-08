/** mods/registry.json 재생성. 모든 mods/{id}/latest.json을 취합한다. 멱등. */
import { getJson, putJson, listPrefixes } from './r2.js';
import { isoNow } from './mods-format.js';

export function buildRegistryEntry(latest, existingEntry) {
  const loaders = Object.entries(latest.loaders || {}).map(([type, data]) => {
    const gvKeys = Object.keys(data.gameVersions || {});
    const first = data.gameVersions[gvKeys[0]] || {};
    return {
      type,
      minVersion: first.minLoaderVersion || '0.0.0',
      maxVersion: first.maxLoaderVersion ?? null,
      supportedGameVersions: gvKeys,
    };
  });

  return {
    id: latest.modId,
    name: latest.name,
    description: existingEntry?.description || `HyeniMC ${latest.modId} mod`,
    latestVersion: latest.version,
    category: latest.category || 'optional',
    gameVersions: latest.gameVersions || [],
    loaders,
    dependencies: existingEntry?.dependencies || { required: [], optional: [] },
  };
}

export async function rebuildRegistry(env) {
  const existing = await getJson(env, 'mods/registry.json');
  const existingById = new Map((existing?.mods || []).map((m) => [m.id, m]));

  const modIds = await listPrefixes(env, 'mods/');
  const mods = [];
  for (const id of modIds) {
    const latest = await getJson(env, `mods/${id}/latest.json`);
    if (!latest || !latest.modId) continue; // latest.json 없는 디렉터리 스킵
    mods.push(buildRegistryEntry(latest, existingById.get(id)));
  }
  mods.sort((a, b) => a.id.localeCompare(b.id));

  const registry = { version: '2.0', lastUpdated: isoNow(), mods };
  await putJson(env, 'mods/registry.json', registry);
  return registry;
}
