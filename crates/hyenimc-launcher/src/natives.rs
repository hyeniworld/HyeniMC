//! natives jar 추출 — `<instance>/versions/<id>/natives`에 전개 (META-INF 제외).

use std::path::{Path, PathBuf};

use crate::LauncherError;

/// 구식 natives 맵의 OS 키 (piston: {"osx": "natives-osx", ...})
pub fn native_classifier_key() -> &'static str {
    crate::rules::os_name()
}

pub fn extract_natives(version_dir: &Path, jars: &[PathBuf]) -> Result<PathBuf, LauncherError> {
    let natives_dir = version_dir.join("natives");
    std::fs::create_dir_all(&natives_dir)?;
    for jar in jars {
        let file = std::fs::File::open(jar)?;
        let mut zip =
            zip::ZipArchive::new(file).map_err(|e| LauncherError::Other(e.to_string()))?;
        for i in 0..zip.len() {
            let mut entry = zip
                .by_index(i)
                .map_err(|e| LauncherError::Other(e.to_string()))?;
            let name = entry.name().to_string();
            if name.starts_with("META-INF") || name.ends_with('/') {
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

        let out = extract_natives(&vdir, &[jar]).unwrap();

        assert_eq!(out, vdir.join("natives"));
        assert_eq!(std::fs::read(out.join("libglfw.dylib")).unwrap(), b"native-bytes");
        assert_eq!(std::fs::read(out.join("sub/liblwjgl.dylib")).unwrap(), b"native2");
        assert!(!out.join("META-INF").exists());
    }
}
