//! natives jar 추출 — `<instance>/versions/<id>/natives`에 전개 (META-INF 제외).

use std::path::{Path, PathBuf};

use crate::LauncherError;

/// 구식 natives 맵의 OS 키 (piston: {"osx": "natives-osx", ...})
pub fn native_classifier_key() -> &'static str {
    crate::rules::os_name()
}

/// natives jar들을 추출. 각 항목은 (jar 경로, 제외 패턴). 제외 패턴은 버전 JSON `extract.exclude`에서
/// 오며(공식 런처 동일), 그 접두사로 시작하는 엔트리는 추출하지 않는다.
pub fn extract_natives(
    version_dir: &Path,
    jars: &[(PathBuf, Vec<String>)],
) -> Result<PathBuf, LauncherError> {
    let natives_dir = version_dir.join("natives");
    std::fs::create_dir_all(&natives_dir)?;
    for (jar, exclude) in jars {
        let file = std::fs::File::open(jar)?;
        let mut zip =
            zip::ZipArchive::new(file).map_err(|e| LauncherError::Other(e.to_string()))?;
        for i in 0..zip.len() {
            let mut entry = zip
                .by_index(i)
                .map_err(|e| LauncherError::Other(e.to_string()))?;
            let name = entry.name().to_string();
            // 디렉터리 엔트리 + extract.exclude 접두사에 해당하면 건너뜀
            if name.ends_with('/') || exclude.iter().any(|pat| name.starts_with(pat)) {
                continue;
            }
            let out = natives_dir.join(&name);
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut f = std::fs::File::create(&out)?;
            std::io::copy(&mut entry, &mut f)?;
        }
    }
    Ok(natives_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip(path: &Path) {
        let file = std::fs::File::create(path).unwrap();
        let mut zw = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zw.start_file("libglfw.dylib", opts).unwrap();
        zw.write_all(b"native-bytes").unwrap();
        zw.start_file("sub/liblwjgl.dylib", opts).unwrap();
        zw.write_all(b"native2").unwrap();
        zw.start_file("META-INF/MANIFEST.MF", opts).unwrap();
        zw.write_all(b"manifest").unwrap();
        zw.finish().unwrap();
    }

    #[test]
    fn extracts_natives_excluding_meta_inf() {
        let dir = tempfile::tempdir().unwrap();
        let jar = dir.path().join("n.jar");
        make_zip(&jar);
        let vdir = dir.path().join("versions/1.21.1");
        std::fs::create_dir_all(&vdir).unwrap();

        let out = extract_natives(&vdir, &[(jar, vec!["META-INF/".to_string()])]).unwrap();

        assert_eq!(out, vdir.join("natives"));
        assert_eq!(std::fs::read(out.join("libglfw.dylib")).unwrap(), b"native-bytes");
        assert_eq!(std::fs::read(out.join("sub/liblwjgl.dylib")).unwrap(), b"native2");
        assert!(!out.join("META-INF").exists());
    }

    #[test]
    fn respects_custom_exclude_patterns() {
        // 데이터 기반: exclude에 지정된 다른 접두사도 제외되는지
        let dir = tempfile::tempdir().unwrap();
        let jar = dir.path().join("n.jar");
        make_zip(&jar);
        let vdir = dir.path().join("v");
        std::fs::create_dir_all(&vdir).unwrap();

        // "sub/"를 제외 → sub/liblwjgl.dylib 미추출, META-INF는 제외 안 함(추출됨)
        let out = extract_natives(&vdir, &[(jar, vec!["sub/".to_string()])]).unwrap();
        assert!(out.join("libglfw.dylib").exists());
        assert!(!out.join("sub").exists());
        assert!(out.join("META-INF/MANIFEST.MF").exists());
    }
}
