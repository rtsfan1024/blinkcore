use tracing;

/// Memory monitor: logs RSS every 60s.
///
/// On Linux reads `/proc/self/statm`. On unsupported platforms the
/// function returns immediately without spawning.
pub fn spawn_memory_monitor() {
    #[cfg(target_os = "linux")]
    {
        use std::time::Duration;
        tokio::spawn(async {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                match procfs::process::Process::myself() {
                    Ok(proc) => match proc.stat() {
                        Ok(stat) => {
                            // procfs 0.16: rss_bytes() 返回包装类型，改用 stat.rss（页数）
                            // x86_64 页大小 = 4096 bytes, 转 KB: pages * 4
                            let rss_kb = stat.rss as u64 * 4;
                            tracing::info!("RSS: {} KB", rss_kb);
                        }
                        Err(e) => {
                            tracing::warn!("memory_monitor: stat() failed: {}", e);
                        }
                    },
                    Err(e) => {
                        tracing::warn!("memory_monitor: Process::myself() failed: {}", e);
                    }
                }
            }
        });
    }

    #[cfg(not(target_os = "linux"))]
    {
        tracing::info!("memory_monitor: not supported on this platform");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_spawn_memory_monitor_does_not_panic() {
        // Spawn should never panic regardless of platform
        spawn_memory_monitor();
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}