//! NeoForge/Fabric 로더 버전 조회 스모크 (실 maven/meta 접속).
//! 실행: cargo run -p hyenimc-launcher --example loader_versions -- <loader> <mc_version>

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let loader = args.next().unwrap_or_else(|| "neoforge".to_string());
    let mc = args.next().unwrap_or_else(|| "1.21.1".to_string());
    let http = reqwest::Client::new();

    match loader.as_str() {
        "neoforge" => {
            let all = hyenimc_launcher::loader::neoforge_versions(&http).await.unwrap();
            let matched: Vec<_> = all
                .iter()
                .filter(|v| hyenimc_launcher::loader::neoforge_matches_mc(v, &mc))
                .cloned()
                .collect();
            println!("전체 {}개, {mc} 매칭 {}개", all.len(), matched.len());
            println!("매칭 샘플: {:?}", matched.iter().rev().take(5).collect::<Vec<_>>());
        }
        "fabric" => {
            let list = hyenimc_launcher::loader::fabric_loader_versions(&http, &mc).await.unwrap();
            println!("fabric {}개, 샘플 {:?}", list.len(), list.iter().take(3).collect::<Vec<_>>());
        }
        other => eprintln!("알 수 없는 로더: {other}"),
    }
}
