//! Keeps blocking work off the main thread.
//!
//! Tauri runs a command without `async` on the main thread, so the window cannot repaint or
//! take input until it returns. Commands doing file or image work wrap their body in
//! [`run_blocking`], or in [`run_in_file_order`] when they read or write sidecars. Repeated
//! background renders go to a [`spawn_latest_job_worker`].

use std::sync::mpsc::{self, Receiver, Sender};

use tauri::{AppHandle, Manager};

use crate::app_state::AppState;

pub async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

/// Like [`run_blocking`], but one at a time in call order with the other file commands, as
/// they ran on the main thread, so read-modify-write sidecar updates cannot interleave.
pub async fn run_in_file_order<T, F>(app_handle: &AppHandle, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let state = app_handle.state::<AppState>();
    let _turn = state.file_command_order.lock().await;
    run_blocking(work).await
}

/// Runs `handle` on its own thread for each job sent to the returned sender. Jobs that arrive
/// while one is being handled replace each other, so only the newest of them runs.
pub fn spawn_latest_job_worker<J: Send + 'static>(
    mut handle: impl FnMut(J) + Send + 'static,
) -> Sender<J> {
    let (tx, rx): (Sender<J>, Receiver<J>) = mpsc::channel();
    std::thread::spawn(move || {
        while let Ok(mut job) = rx.recv() {
            while let Ok(latest) = rx.try_recv() {
                job = latest;
            }
            handle(job);
        }
    });
    tx
}

#[cfg(test)]
mod tests {
    use super::spawn_latest_job_worker;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn jobs_queued_while_busy_collapse_to_the_newest() {
        let (gate_tx, gate_rx) = mpsc::channel::<()>();
        let (done_tx, done_rx) = mpsc::channel();
        let worker = spawn_latest_job_worker(move |job: u32| {
            if job == 1 {
                gate_rx.recv().unwrap();
            }
            done_tx.send(job).unwrap();
        });

        worker.send(1).unwrap();
        // Let the worker take job 1 before the others arrive.
        std::thread::sleep(Duration::from_millis(50));
        for job in 2..=4 {
            worker.send(job).unwrap();
        }
        gate_tx.send(()).unwrap();

        let timeout = Duration::from_secs(5);
        assert_eq!(done_rx.recv_timeout(timeout).unwrap(), 1);
        assert_eq!(done_rx.recv_timeout(timeout).unwrap(), 4);
        assert!(done_rx.recv_timeout(Duration::from_millis(100)).is_err());
    }
}
