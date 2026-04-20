use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const ADJECTIVES: &[&str] = &[
    "happy", "snarky", "mellow", "fierce", "crimson", "lumen", "zesty", "brisk", "tidal", "clever",
    "sleepy", "plucky", "electric", "quiet", "bold", "gentle", "dusty", "lunar", "vivid", "breezy",
];

const CREATURES: &[&str] = &[
    "otter", "ferret", "moth", "heron", "crab", "wombat", "finch", "gecko", "badger", "raven",
    "fox", "lynx", "newt", "tern", "whale", "beetle", "falcon", "mole", "mantis", "lemur",
];

pub fn valid_nick(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 40
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn pick_nick(counter: &AtomicU64) -> String {
    let n = counter.fetch_add(1, Ordering::Relaxed);
    // Mix bits so the two indices decorrelate (without mixing,
    // consecutive n values share a creature bucket).
    let a = n.wrapping_mul(2654435761);
    let b = n.wrapping_mul(11400714819323198485);
    let adj = ADJECTIVES[(a as usize) % ADJECTIVES.len()];
    let creature = CREATURES[(b as usize) % CREATURES.len()];
    let suffix = (b >> 32) as u16 % 100;
    format!("{adj}-{creature}-{suffix:02}")
}

pub fn seed_counter() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}
