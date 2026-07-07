#!/usr/bin/env node
/**
 * 버전 단일 소스화 — package.json version을 Tauri(tauri.conf.json)와
 * Rust 워크스페이스(Cargo.toml [workspace.package] version)에 전파한다.
 *
 * package.json 하나만 바꾸면 헤더(App.tsx)·번들·updater·crate 버전이 모두 일치.
 * dev:tauri / build:tauri 앞에서 자동 실행된다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[sync-version] package.json version이 semver가 아님: ${version}`);
  process.exit(1);
}

let changed = 0;

// 1) tauri.conf.json 의 "version"
const tauriConfPath = join(root, 'apps/launcher/src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
if (tauriConf.version !== version) {
  tauriConf.version = version;
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
  changed++;
}

// 2) 워크스페이스 Cargo.toml 의 [workspace.package] version (해당 라인만 치환)
const cargoPath = join(root, 'Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
const updatedCargo = cargo.replace(
  /(\[workspace\.package\][\s\S]*?\nversion = ")[^"]*(")/,
  `$1${version}$2`
);
if (updatedCargo !== cargo) {
  writeFileSync(cargoPath, updatedCargo);
  changed++;
}

console.log(`[sync-version] version=${version} (${changed}개 파일 동기화)`);
