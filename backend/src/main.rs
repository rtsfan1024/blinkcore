mod api;
mod monitor;
mod search;
mod storage;
mod types;

use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    // 初始化数据库
    let db_path = std::env::var("BLINKCORE_DB_PATH").unwrap_or_else(|_| "blog.db".to_string());
    let state = storage::pool::init_db(&db_path)?;

    let app = api::router::build_app(state);

    // 启动内存监控
    monitor::memory::spawn_memory_monitor();

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000").await?;
    tracing::info!("listening on 0.0.0.0:8000");

    axum::serve(listener, app).await?;

    Ok(())
}