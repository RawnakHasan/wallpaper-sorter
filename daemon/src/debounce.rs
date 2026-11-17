//! Decides when a file that was just written is finished: nothing new has happened to it for a
//! while and its size has not changed. Driven by explicit times, so it can be tested without waiting.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

struct Pending {
    last_event: Instant,
    seen_size: Option<u64>,
}

pub struct Debouncer {
    stable_for: Duration,
    pending: HashMap<PathBuf, Pending>,
    /// Files that are known to be finished already (the startup scan).
    stable_now: Vec<PathBuf>,
}

impl Debouncer {
    pub fn new(stable_for: Duration) -> Debouncer {
        Debouncer { stable_for, pending: HashMap::new(), stable_now: Vec::new() }
    }

    /// Something happened to `path`; `size` is its size right now (None if it cannot be read).
    pub fn event(&mut self, path: PathBuf, now: Instant, size: Option<u64>) {
        self.pending.insert(path, Pending { last_event: now, seen_size: size });
    }

    /// A file that is already complete: it comes out of the next `poll` without waiting.
    pub fn push_stable(&mut self, path: PathBuf) {
        self.pending.remove(&path);
        if !self.stable_now.contains(&path) {
            self.stable_now.push(path);
        }
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty() && self.stable_now.is_empty()
    }

    /// How long until something might be ready (zero if something is ready now); None if nothing is waiting.
    pub fn next_wait(&self, now: Instant) -> Option<Duration> {
        if !self.stable_now.is_empty() {
            return Some(Duration::ZERO);
        }
        self.pending
            .values()
            .map(|p| (p.last_event + self.stable_for).saturating_duration_since(now))
            .min()
    }

    /// Files that are finished: the startup ones, and those untouched for `stable_for` whose size is
    /// still what it was. A file that grew gets another window; one that vanished is forgotten.
    /// `stat` returns the current size, or None if the file is gone.
    pub fn poll(&mut self, now: Instant, mut stat: impl FnMut(&Path) -> Option<u64>) -> Vec<PathBuf> {
        let mut ready: Vec<PathBuf> = std::mem::take(&mut self.stable_now);
        let mut forget = Vec::new();
        for (path, p) in self.pending.iter_mut() {
            if now.saturating_duration_since(p.last_event) < self.stable_for {
                continue;
            }
            match stat(path) {
                None => forget.push(path.clone()),
                Some(size) if p.seen_size == Some(size) => ready.push(path.clone()),
                Some(size) => {
                    p.seen_size = Some(size);
                    p.last_event = now;
                }
            }
        }
        for path in ready.iter().chain(forget.iter()) {
            self.pending.remove(path);
        }
        ready.sort();
        ready.dedup();
        ready
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn ready_after_the_quiet_period() {
        let t0 = Instant::now();
        let mut d = Debouncer::new(Duration::from_millis(1000));
        d.event(p("/a.png"), t0, Some(10));
        assert!(d.poll(t0 + Duration::from_millis(900), |_| Some(10)).is_empty());
        assert_eq!(d.poll(t0 + Duration::from_millis(1000), |_| Some(10)), [p("/a.png")]);
        assert!(d.is_empty());
    }

    #[test]
    fn a_growing_file_gets_another_window() {
        let t0 = Instant::now();
        let mut d = Debouncer::new(Duration::from_millis(1000));
        d.event(p("/a.png"), t0, Some(10));
        assert!(d.poll(t0 + Duration::from_millis(1000), |_| Some(50)).is_empty());
        assert!(d.poll(t0 + Duration::from_millis(1500), |_| Some(50)).is_empty());
        assert_eq!(d.poll(t0 + Duration::from_millis(2000), |_| Some(50)), [p("/a.png")]);
    }

    #[test]
    fn a_new_event_restarts_the_clock() {
        let t0 = Instant::now();
        let mut d = Debouncer::new(Duration::from_millis(1000));
        d.event(p("/a.png"), t0, Some(10));
        d.event(p("/a.png"), t0 + Duration::from_millis(800), Some(10));
        assert!(d.poll(t0 + Duration::from_millis(1000), |_| Some(10)).is_empty());
        assert_eq!(d.poll(t0 + Duration::from_millis(1800), |_| Some(10)), [p("/a.png")]);
    }

    #[test]
    fn a_vanished_file_is_forgotten() {
        let t0 = Instant::now();
        let mut d = Debouncer::new(Duration::from_millis(100));
        d.event(p("/a.png"), t0, Some(10));
        assert!(d.poll(t0 + Duration::from_millis(200), |_| None).is_empty());
        assert!(d.is_empty());
    }

    #[test]
    fn startup_files_do_not_wait() {
        let t0 = Instant::now();
        let mut d = Debouncer::new(Duration::from_secs(60));
        d.push_stable(p("/b.png"));
        d.push_stable(p("/a.png"));
        assert_eq!(d.next_wait(t0), Some(Duration::ZERO));
        assert_eq!(d.poll(t0, |_| Some(1)), [p("/a.png"), p("/b.png")]);
    }

    #[test]
    fn next_wait_counts_down() {
        let t0 = Instant::now();
        let mut d = Debouncer::new(Duration::from_millis(1000));
        assert_eq!(d.next_wait(t0), None);
        d.event(p("/a.png"), t0, Some(1));
        assert_eq!(d.next_wait(t0 + Duration::from_millis(400)), Some(Duration::from_millis(600)));
        assert_eq!(d.next_wait(t0 + Duration::from_millis(5000)), Some(Duration::ZERO));
    }
}
