//! 실인스턴스 mods 디렉터리 파싱 스모크: cargo run -p hyenimc-launcher --example list_mods -- <mods_dir>

fn main() {
    let dir = std::env::args().nth(1).expect("사용법: list_mods <mods_dir>");
    let mods = hyenimc_launcher::modmeta::list_mods(std::path::Path::new(&dir));
    let unknown = mods.iter().filter(|m| m.version == "Unknown").count();
    let unnamed = mods.iter().filter(|m| m.name.ends_with(".jar")).count();
    let disabled = mods.iter().filter(|m| !m.enabled).count();
    println!("총 {}개 (비활성 {disabled}, 버전 미상 {unknown}, 이름 폴백 {unnamed})", mods.len());
    for m in mods.iter().take(5) {
        println!("  {} | {} | {} | enabled={}", m.name, m.version, m.mod_id, m.enabled);
    }
}
