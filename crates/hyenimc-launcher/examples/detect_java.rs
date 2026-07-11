#[tokio::main]
async fn main() {
    for j in hyenimc_launcher::java::detect_java_installations().await.iter().take(4) {
        println!("Java {} ({}) vendor={:?} path={}", j.major_version, j.architecture, j.vendor, j.path);
    }
}
