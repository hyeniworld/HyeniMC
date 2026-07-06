use std::path::Path;

fn main() {
    // 프로덕션 빌드 시 .env의 값을 컴파일 상수로 주입 (option_env! 대응).
    // 우선순위: 이미 설정된 환경변수 > .env 파일. 없으면 런타임 std::env 폴백(코드에 존재).
    inject_env_from_dotenv();
    tauri_build::build();
}

fn inject_env_from_dotenv() {
    const KEYS: [&str; 2] = ["AZURE_CLIENT_ID", "HYENIMC_WORKER_URL"];

    // src-tauri 기준 워크스페이스 루트(HyeniMC)의 .env
    let dotenv = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.env");
    println!("cargo:rerun-if-changed={}", dotenv.display());
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }

    let file_vals = std::fs::read_to_string(&dotenv)
        .ok()
        .map(|text| parse_dotenv(&text))
        .unwrap_or_default();

    for key in KEYS {
        // 실제 환경변수 우선, 없으면 .env 값
        let value = std::env::var(key)
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| file_vals.get(key).cloned());
        if let Some(v) = value {
            println!("cargo:rustc-env={key}={v}");
        }
    }
}

fn parse_dotenv(text: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let v = v.trim().trim_matches('"').trim_matches('\'');
            out.insert(k.trim().to_string(), v.to_string());
        }
    }
    out
}
