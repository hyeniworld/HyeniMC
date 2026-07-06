//! Java 설치 감지 — TS java-detector.ts 의미 포팅 (macOS 우선).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInstallation {
    pub path: String,
    pub version: String,
    pub major_version: u32,
}

/// `java -version` stderr에서 `version "..."` 안의 버전 문자열 추출.
pub fn parse_java_version_output(out: &str) -> Option<String> {
    let idx = out.find("version \"")? + "version \"".len();
    let rest = &out[idx..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// "1.8.0_392" → 8, "21.0.5" → 21, "17" → 17
pub fn parse_major(version: &str) -> u32 {
    let mut parts = version.split(['.', '_', '-']);
    let first: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    if first == 1 {
        parts.next().and_then(|p| p.parse().ok()).unwrap_or(first)
    } else {
        first
    }
}

async fn probe(java_path: &std::path::Path) -> Option<JavaInstallation> {
    let output = tokio::process::Command::new(java_path)
        .arg("-version")
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&output.stderr);
    let version = parse_java_version_output(&text)?;
    Some(JavaInstallation {
        path: java_path.display().to_string(),
        major_version: parse_major(&version),
        version,
    })
}

pub async fn detect_java_installations() -> Vec<JavaInstallation> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        // /usr/libexec/java_home -V 는 stderr에 목록 출력 — 각 홈 경로 추출
        if let Ok(out) = tokio::process::Command::new("/usr/libexec/java_home")
            .arg("-V")
            .output()
            .await
        {
            let text = String::from_utf8_lossy(&out.stderr);
            for line in text.lines() {
                if let Some(idx) = line.find('/') {
                    let home = line[idx..].trim();
                    candidates.push(std::path::Path::new(home).join("bin/java"));
                }
            }
        }
        let user_jvms = format!(
            "{}/Library/Java/JavaVirtualMachines",
            std::env::var("HOME").unwrap_or_default()
        );
        for base in ["/Library/Java/JavaVirtualMachines", user_jvms.as_str()] {
            if let Ok(mut rd) = tokio::fs::read_dir(base).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    candidates.push(entry.path().join("Contents/Home/bin/java"));
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 벤더별 설치 루트: <ProgramFiles>\<vendor>\<jdk-xx>\bin\java.exe
        const VENDOR_DIRS: [&str; 7] = [
            "Java",
            "Eclipse Adoptium",
            "Microsoft",
            "Zulu",
            "Amazon Corretto",
            "BellSoft",
            "Semeru",
        ];
        let mut bases: Vec<std::path::PathBuf> = Vec::new();
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(pf) = std::env::var_os(var) {
                for vendor in VENDOR_DIRS {
                    bases.push(std::path::Path::new(&pf).join(vendor));
                }
            }
        }
        // 사용자 설치 (Adoptium 등의 per-user 설치 위치)
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            bases.push(std::path::Path::new(&local).join("Programs").join("Eclipse Adoptium"));
        }
        for base in bases {
            if let Ok(mut rd) = tokio::fs::read_dir(&base).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    candidates.push(entry.path().join(r"bin\java.exe"));
                }
            }
        }
    }

    // JAVA_HOME (전 플랫폼)
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        let bin = if cfg!(windows) { r"bin\java.exe" } else { "bin/java" };
        candidates.push(std::path::Path::new(&home).join(bin));
    }

    // PATH의 java
    if let Ok(path) = which_java().await {
        candidates.push(path);
    }

    let mut found: Vec<JavaInstallation> = Vec::new();
    for c in candidates {
        if !c.exists() {
            continue;
        }
        let display = c.display().to_string();
        if found.iter().any(|j| j.path == display) {
            continue;
        }
        if let Some(j) = probe(&c).await {
            if !found.iter().any(|e| e.path == j.path) {
                found.push(j);
            }
        }
    }
    found.sort_by(|a, b| b.major_version.cmp(&a.major_version));
    found
}

async fn which_java() -> Result<std::path::PathBuf, ()> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let out = tokio::process::Command::new(cmd)
        .arg("java")
        .output()
        .await
        .map_err(|_| ())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next().ok_or(())?.trim();
    if first.is_empty() {
        Err(())
    } else {
        Ok(std::path::PathBuf::from(first))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modern_version_output() {
        let out = r#"openjdk version "21.0.5" 2024-10-15 LTS"#;
        assert_eq!(parse_java_version_output(out).as_deref(), Some("21.0.5"));
    }

    #[test]
    fn parses_legacy_version_output() {
        let out = r#"java version "1.8.0_392""#;
        assert_eq!(parse_java_version_output(out).as_deref(), Some("1.8.0_392"));
    }

    #[test]
    fn major_version_rules() {
        assert_eq!(parse_major("1.8.0_392"), 8);
        assert_eq!(parse_major("21.0.5"), 21);
        assert_eq!(parse_major("17"), 17);
    }

    #[tokio::test]
    async fn smoke_detect_on_this_machine() {
        // 실기 환경 의존 — 설치 0개여도 실패하지 않고 목록만 출력
        let found = detect_java_installations().await;
        for j in &found {
            println!("java: {} ({} / major {})", j.path, j.version, j.major_version);
        }
    }
}
