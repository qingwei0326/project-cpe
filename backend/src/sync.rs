//! Lock helpers that keep working after another thread panicked while holding the lock.
//!
//! `std::sync::Mutex` / `RwLock` become "poisoned" when a holder panics, and every later
//! `lock().unwrap()` then panics too, so a single bug in one request handler could take the
//! whole management service down (or permanently disable a subsystem that merely maps the
//! poison error to a failure). The data these locks guard (a SQLite connection, the in-memory
//! config, call bookkeeping, telemetry counters) stays structurally valid after a panic, so the
//! right behaviour for a long-running appliance is to log it once and carry on.

use std::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub trait MutexExt<T> {
    /// Lock the mutex, recovering the guard if a previous holder panicked.
    fn lock_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> MutexExt<T> for Mutex<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| {
            tracing::warn!("recovered a poisoned mutex; a previous holder panicked");
            poisoned.into_inner()
        })
    }
}

pub trait RwLockExt<T> {
    /// Read-lock, recovering the guard if a previous writer panicked.
    fn read_recover(&self) -> RwLockReadGuard<'_, T>;
    /// Write-lock, recovering the guard if a previous holder panicked.
    fn write_recover(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T> RwLockExt<T> for RwLock<T> {
    fn read_recover(&self) -> RwLockReadGuard<'_, T> {
        self.read().unwrap_or_else(|poisoned| {
            tracing::warn!("recovered a poisoned rwlock (read); a previous holder panicked");
            poisoned.into_inner()
        })
    }

    fn write_recover(&self) -> RwLockWriteGuard<'_, T> {
        self.write().unwrap_or_else(|poisoned| {
            tracing::warn!("recovered a poisoned rwlock (write); a previous holder panicked");
            poisoned.into_inner()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn poison_mutex(mutex: &Arc<Mutex<i32>>) {
        let clone = Arc::clone(mutex);
        let _ = std::thread::spawn(move || {
            let _guard = clone.lock().expect("first lock");
            panic!("simulated handler panic while holding the lock");
        })
        .join();
    }

    #[test]
    fn mutex_stays_usable_after_a_holder_panics() {
        let mutex = Arc::new(Mutex::new(41));
        poison_mutex(&mutex);
        assert!(mutex.lock().is_err(), "the plain lock is poisoned");

        *mutex.lock_recover() += 1;
        assert_eq!(
            *mutex.lock_recover(),
            42,
            "state written before and after the panic is kept"
        );
    }

    #[test]
    fn rwlock_stays_usable_after_a_writer_panics() {
        let lock = Arc::new(RwLock::new(String::from("a")));
        let clone = Arc::clone(&lock);
        let _ = std::thread::spawn(move || {
            let _guard = clone.write().expect("first write");
            panic!("simulated panic while writing");
        })
        .join();
        assert!(lock.read().is_err() && lock.write().is_err());

        lock.write_recover().push('b');
        assert_eq!(lock.read_recover().as_str(), "ab");
    }

    #[test]
    fn healthy_locks_behave_like_the_plain_ones() {
        let mutex = Mutex::new(1);
        *mutex.lock_recover() = 2;
        assert_eq!(*mutex.lock().unwrap(), 2);
        let lock = RwLock::new(1);
        *lock.write_recover() = 3;
        assert_eq!(*lock.read_recover(), 3);
    }
}
