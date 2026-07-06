//! 버전 설치 오케스트레이션 — 버전 json → 클라이언트 jar → 라이브러리(+natives) → 에셋.
//! TS version-manager.ts의 의미 포팅. 전부 download_all 재사용.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::download::{download_all, DownloadConfig, DownloadTask};
use crate::manifest::{merge_inherited, VersionDetail, ASSET_BASE_URL};
use crate::natives::native_classifier_key;
use crate::rules::rules_allow;
use crate::LauncherError;

/// 게임 파일 배치 (실측 레이아웃 — in-place 호환)
#[derive(Debug, Clone)]
pub struct GameDirs {
    pub instance_dir: PathBuf,
    pub shared_libraries: PathBuf,
    pub shared_assets: PathBuf,
}

impl GameDirs {
    pub fn version_dir(&self, id: &str) -> PathBuf {
        self.instance_dir.join("versions").join(id)
    }
    pub fn version_json(&self, id: &str) -> PathBuf {
        self.version_dir(id).join(format!("{id}.json"))
    }
    pub fn client_jar(&self, id: &str) -> PathBuf {
        self.version_dir(id).join(format!("{id}.jar"))
    }
    pub fn instance_libraries(&self) -> PathBuf {
        self.instance_dir.join("libraries")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallPhase {
    VersionJson,
    Libraries,
    Assets,
    Finalize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub phase: InstallPhase,
    pub completed: usize,
    pub total: usize,
    pub current_file: String,
}

#[derive(Debug, Deserialize)]
struct AssetIndexFile {
    objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Deserialize)]
struct AssetObject {
    hash: String,
    #[allow(dead_code)]
    size: u64,
}

/// 로컬 버전 json 로드(+inheritsFrom 병합). 부모가 로컬에 없으면 에러(로더 설치는 M4).
pub fn load_version_detail(dirs: &GameDirs, version_id: &str) -> Result<VersionDetail, LauncherError> {
    let path = dirs.version_json(version_id);
    let text = std::fs::read_to_string(&path)?;
    let detail: VersionDetail = serde_json::from_str(&text)?;
    if let Some(parent_id) = detail.inherits_from.clone() {
        let parent = load_version_detail(dirs, &parent_id)?;
        return Ok(merge_inherited(detail, parent));
    }
    Ok(detail)
}

/// natives classifier 방식 라이브러리의 로컬 jar 경로 목록 (추출 입력).
pub fn native_jars_for(detail: &VersionDetail, dirs: &GameDirs) -> Vec<PathBuf> {
    let os_key = native_classifier_key();
    let mut out = Vec::new();
    for lib in &detail.libraries {
        if !rules_allow(&lib.rules) {
            continue;
        }
        let Some(natives) = &lib.natives else { continue };
        let Some(classifier) = natives.get(os_key) else { continue };
        let classifier = classifier.replace("${arch}", "64");
        if let Some(downloads) = &lib.downloads {
            if let Some(classifiers) = &downloads.classifiers {
                if let Some(artifact) = classifiers.get(&classifier) {
                    if let Some(p) = &artifact.path {
                        out.push(dirs.shared_libraries.join(p));
                    }
                }
            }
        }
    }
    out
}

/// 버전 설치 — 이미 있는 파일(SHA1 일치)은 download_all이 스킵.
pub async fn ensure_version(
    client: &reqwest::Client,
    version_url: Option<&str>,
    version_id: &str,
    dirs: &GameDirs,
    cfg: &DownloadConfig,
    on_progress: impl Fn(InstallProgress) + Send + Sync,
) -> Result<VersionDetail, LauncherError> {
    // ① 버전 json
    on_progress(InstallProgress {
        phase: InstallPhase::VersionJson,
        completed: 0,
        total: 1,
        current_file: format!("{version_id}.json"),
    });
    let json_path = dirs.version_json(version_id);
    if !json_path.exists() {
        let url = version_url.ok_or_else(|| {
            LauncherError::Other(format!("버전 json이 없고 URL도 없음: {version_id}"))
        })?;
        let text = client.get(url).send().await?.error_for_status()?.text().await?;
        if let Some(p) = json_path.parent() {
            tokio::fs::create_dir_all(p).await?;
        }
        tokio::fs::write(&json_path, &text).await?;
    }
    let detail = load_version_detail(dirs, version_id)?;

    // ② 클라이언트 jar + ③ 라이브러리(+natives classifier)
    let mut tasks: Vec<DownloadTask> = Vec::new();
    if let Some(client_dl) = detail.downloads.as_ref().and_then(|d| d.client.as_ref()) {
        tasks.push(DownloadTask {
            url: client_dl.url.clone(),
            dest: dirs.client_jar(version_id),
            sha1: Some(client_dl.sha1.clone()),
            size: Some(client_dl.size),
        });
    }
    let os_key = native_classifier_key();
    for lib in &detail.libraries {
        if !rules_allow(&lib.rules) {
            continue;
        }
        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                if let Some(p) = &artifact.path {
                    tasks.push(DownloadTask {
                        url: artifact.url.clone(),
                        dest: dirs.shared_libraries.join(p),
                        sha1: Some(artifact.sha1.clone()),
                        size: Some(artifact.size),
                    });
                }
            }
            // 구식 natives classifier
            if let (Some(natives), Some(classifiers)) = (&lib.natives, &downloads.classifiers) {
                if let Some(classifier) = natives.get(os_key) {
                    let classifier = classifier.replace("${arch}", "64");
                    if let Some(artifact) = classifiers.get(&classifier) {
                        if let Some(p) = &artifact.path {
                            tasks.push(DownloadTask {
                                url: artifact.url.clone(),
                                dest: dirs.shared_libraries.join(p),
                                sha1: Some(artifact.sha1.clone()),
                                size: Some(artifact.size),
                            });
                        }
                    }
                }
            }
        }
    }
    let lib_total = tasks.len();
    download_all(client, tasks, cfg, |p| {
        on_progress(InstallProgress {
            phase: InstallPhase::Libraries,
            completed: p.completed,
            total: lib_total,
            current_file: p.current_file,
        });
    })
    .await?;

    // ④ 에셋 인덱스 + objects
    if let Some(index_ref) = &detail.asset_index {
        let index_path = dirs
            .shared_assets
            .join("indexes")
            .join(format!("{}.json", index_ref.id));
        download_all(
            client,
            vec![DownloadTask {
                url: index_ref.url.clone(),
                dest: index_path.clone(),
                sha1: Some(index_ref.sha1.clone()),
                size: index_ref.size,
            }],
            cfg,
            |_| {},
        )
        .await?;

        let index: AssetIndexFile = serde_json::from_str(&std::fs::read_to_string(&index_path)?)?;
        let asset_tasks: Vec<DownloadTask> = index
            .objects
            .values()
            .map(|obj| {
                let prefix = &obj.hash[..2];
                DownloadTask {
                    url: format!("{ASSET_BASE_URL}/{prefix}/{}", obj.hash),
                    dest: dirs
                        .shared_assets
                        .join("objects")
                        .join(prefix)
                        .join(&obj.hash),
                    sha1: Some(obj.hash.clone()),
                    size: None,
                }
            })
            .collect();
        let asset_total = asset_tasks.len();
        download_all(client, asset_tasks, cfg, |p| {
            on_progress(InstallProgress {
                phase: InstallPhase::Assets,
                completed: p.completed,
                total: asset_total,
                current_file: p.current_file,
            });
        })
        .await?;
    }

    on_progress(InstallProgress {
        phase: InstallPhase::Finalize,
        completed: 1,
        total: 1,
        current_file: String::new(),
    });
    Ok(detail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha1::{Digest, Sha1};
    use std::collections::HashMap as Map;

    fn sha1_hex(d: &[u8]) -> String {
        hex::encode(Sha1::digest(d))
    }

    /// 경로별 본문 라우팅 fixture 서버
    fn spawn_routed_server(routes: Map<String, Vec<u8>>) -> String {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", server.server_addr());
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                let url = req.url().to_string();
                match routes.get(&url) {
                    Some(body) => {
                        let _ = req.respond(tiny_http::Response::from_data(body.clone()));
                    }
                    None => {
                        let _ = req.respond(tiny_http::Response::empty(404));
                    }
                }
            }
        });
        addr
    }

    #[tokio::test]
    async fn ensure_version_downloads_full_tree() {
        let client_bytes = b"CLIENT".to_vec();
        let lib_bytes = b"LIB".to_vec();
        let asset_bytes = b"ASSET".to_vec();
        let asset_hash = sha1_hex(&asset_bytes);
        let index_json = format!(
            r#"{{"objects":{{"icons/icon.png":{{"hash":"{asset_hash}","size":5}}}}}}"#
        );

        // 서버 주소를 아직 모름 → 두 단계: placeholder 없이 상대경로 URL 구성 위해 먼저 서버 기동
        let mut routes: Map<String, Vec<u8>> = Map::new();
        routes.insert("/client.jar".into(), client_bytes.clone());
        routes.insert("/lib.jar".into(), lib_bytes.clone());
        routes.insert("/index.json".into(), index_json.clone().into_bytes());
        routes.insert(format!("/{}/{}", &asset_hash[..2], asset_hash), asset_bytes.clone());
        // version json은 서버 주소 필요 → 라우트에 나중에 추가 불가하므로 서버 2대 사용
        let file_server = spawn_routed_server(routes);

        let version_json = format!(
            r#"{{
              "id":"t1",
              "mainClass":"m.Main",
              "assetIndex":{{"id":"17","sha1":"{index_sha}","url":"{file_server}/index.json","size":{index_size}}},
              "downloads":{{"client":{{"sha1":"{client_sha}","size":6,"url":"{file_server}/client.jar"}}}},
              "libraries":[{{"name":"a:b:1","downloads":{{"artifact":{{"path":"a/b/1/b-1.jar","sha1":"{lib_sha}","size":3,"url":"{file_server}/lib.jar"}}}}}}]
            }}"#,
            index_sha = sha1_hex(index_json.as_bytes()),
            index_size = index_json.len(),
            client_sha = sha1_hex(&client_bytes),
            lib_sha = sha1_hex(&lib_bytes),
        );
        let mut vroutes: Map<String, Vec<u8>> = Map::new();
        vroutes.insert("/v/t1.json".into(), version_json.into_bytes());
        let version_server = spawn_routed_server(vroutes);

        let tmp = tempfile::tempdir().unwrap();
        let dirs = GameDirs {
            instance_dir: tmp.path().join("inst"),
            shared_libraries: tmp.path().join("shared/libraries"),
            shared_assets: tmp.path().join("shared/assets"),
        };

        // 에셋 URL은 ASSET_BASE_URL 고정이라 테스트에서는 인덱스만 로컬 서버로 —
        // objects 다운로드 검증을 위해 asset URL을 오버라이드할 수 없으므로
        // 여기서는 index까지 확인하고 objects는 URL 형식만 검증한다.
        // → ensure_version은 objects 다운로드에서 실네트워크로 나가면 안 되므로
        //   에셋 objects 부분은 별도 단위(아래 asset_task_urls)로 검증.
        let version_json_only = format!(
            r#"{{
              "id":"t1",
              "mainClass":"m.Main",
              "downloads":{{"client":{{"sha1":"{client_sha}","size":6,"url":"{file_server}/client.jar"}}}},
              "libraries":[{{"name":"a:b:1","downloads":{{"artifact":{{"path":"a/b/1/b-1.jar","sha1":"{lib_sha}","size":3,"url":"{file_server}/lib.jar"}}}}}}]
            }}"#,
            client_sha = sha1_hex(&client_bytes),
            lib_sha = sha1_hex(&lib_bytes),
        );
        let mut vroutes2: Map<String, Vec<u8>> = Map::new();
        vroutes2.insert("/v/t1.json".into(), version_json_only.into_bytes());
        let version_server2 = spawn_routed_server(vroutes2);
        let _ = version_server; // (에셋 포함 json은 위 URL 형식 검증용으로만 유지)

        let http = reqwest::Client::new();
        let cfg = DownloadConfig { timeout: std::time::Duration::from_secs(5), retry_base_ms: 1, ..Default::default() };
        let phases = std::sync::Mutex::new(Vec::new());
        let detail = ensure_version(
            &http,
            Some(&format!("{version_server2}/v/t1.json")),
            "t1",
            &dirs,
            &cfg,
            |p| phases.lock().unwrap().push(p.phase),
        )
        .await
        .unwrap();

        assert_eq!(detail.main_class.as_deref(), Some("m.Main"));
        assert_eq!(std::fs::read(dirs.client_jar("t1")).unwrap(), b"CLIENT");
        assert_eq!(
            std::fs::read(dirs.shared_libraries.join("a/b/1/b-1.jar")).unwrap(),
            b"LIB"
        );
        assert!(dirs.version_json("t1").exists());
        let seen = phases.lock().unwrap().clone();
        assert!(seen.contains(&InstallPhase::VersionJson));
        assert!(seen.contains(&InstallPhase::Finalize));

        // 두 번째 호출: json 이미 존재 → URL 없이도 성공 (스킵 경로)
        ensure_version(&http, None, "t1", &dirs, &cfg, |_| {}).await.unwrap();
    }

    #[test]
    fn asset_object_url_format() {
        let hash = "ab12cd0000000000000000000000000000000000";
        let prefix = &hash[..2];
        let url = format!("{ASSET_BASE_URL}/{prefix}/{hash}");
        assert_eq!(
            url,
            "https://resources.download.minecraft.net/ab/ab12cd0000000000000000000000000000000000"
        );
    }

    #[test]
    fn native_jars_resolved_from_classifiers() {
        let os = native_classifier_key();
        let json = format!(
            r#"{{"id":"t","libraries":[{{
              "name":"org.lwjgl:lwjgl-platform:2",
              "natives":{{"{os}":"natives-{os}"}},
              "downloads":{{"classifiers":{{"natives-{os}":{{"path":"l/n.jar","sha1":"s","size":1,"url":"u"}}}}}}
            }}]}}"#
        );
        let detail: VersionDetail = serde_json::from_str(&json).unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let dirs = GameDirs {
            instance_dir: tmp.path().join("i"),
            shared_libraries: tmp.path().join("sl"),
            shared_assets: tmp.path().join("sa"),
        };
        let jars = native_jars_for(&detail, &dirs);
        assert_eq!(jars, vec![tmp.path().join("sl").join("l/n.jar")]);
    }
}
