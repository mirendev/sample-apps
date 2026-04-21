use std::collections::{HashMap, VecDeque};
use std::env;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use redis::{aio::MultiplexedConnection, AsyncCommands};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, oneshot};

const HISTORY_CAP: usize = 200;
const HISTORY_KEY: &str = "chat:history";
pub const GRACE_PERIOD: Duration = Duration::from_secs(60);

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct HistoryEntry {
    pub nick: String,
    pub text: String,
    pub ts: u64,
}

#[derive(Clone, Serialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Welcome {
        nick: String,
        members: Vec<String>,
        history: Vec<HistoryEntry>,
    },
    Join {
        nick: String,
        members: Vec<String>,
    },
    Leave {
        nick: String,
        members: Vec<String>,
    },
    Chat {
        nick: String,
        text: String,
        ts: u64,
    },
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Hello {
        nick: Option<String>,
        uuid: Option<String>,
    },
    Send {
        text: String,
    },
}

pub enum Presence {
    /// One or more live sessions for the same uuid share this nick.
    Active { uuid: String, count: u32 },
    /// No live sessions, but we're holding the seat for up to `GRACE_PERIOD`
    /// so a flaky reconnect from the same uuid resumes silently. Firing the
    /// oneshot cancels the pending cleanup.
    Grace {
        uuid: String,
        cancel: oneshot::Sender<()>,
    },
}

pub enum JoinKind {
    /// Nick is new to the room — caller should broadcast Join.
    Fresh,
    /// Nick was in grace; we cancelled cleanup and resumed. No broadcast.
    Resumed,
    /// Another session already holds this nick (multi-tab). No broadcast.
    Additional,
}

pub struct AppState {
    pub tx: broadcast::Sender<ServerMessage>,
    pub nick_counter: AtomicU64,
    pub page: String,
    pub history: HistoryStore,
    pub members: Mutex<HashMap<String, Presence>>,
}

impl AppState {
    /// Pick a fresh nick atomically under the members lock. `next` is called
    /// repeatedly until it yields a nick nobody currently holds, at which
    /// point we insert it as `Active { uuid, count: 1 }` and return. Closes
    /// the race where two simultaneous connections could both roll the same
    /// unclaimed nick and then both call `join_member`.
    ///
    /// `uuid` is `None` for legacy clients that haven't upgraded to the
    /// UUID-bearing Hello; we store an empty string and treat it as the
    /// pre-UUID loose-match path elsewhere.
    pub fn claim_fresh_nick(&self, uuid: Option<&str>, mut next: impl FnMut() -> String) -> String {
        let mut m = self.members.lock().unwrap();
        loop {
            let candidate = next();
            if !m.contains_key(&candidate) {
                m.insert(
                    candidate.clone(),
                    Presence::Active {
                        uuid: uuid.unwrap_or("").to_string(),
                        count: 1,
                    },
                );
                return candidate;
            }
        }
    }

    /// Attach to an existing nick. Returns `None` if the nick is held by a
    /// different uuid — caller should reassign. Otherwise returns the
    /// `JoinKind` describing how we attached (fresh insert, silent multi-tab,
    /// or grace resume).
    ///
    /// `uuid` is `None` for legacy clients that don't send one. In that case
    /// we skip UUID verification entirely and fall back to the pre-UUID
    /// behavior (loose attach by nick alone). Strict collision protection
    /// only kicks in once both sides speak UUID.
    pub fn join_member(&self, nick: &str, uuid: Option<&str>) -> Option<JoinKind> {
        let mut m = self.members.lock().unwrap();
        match m.get_mut(nick) {
            None => {
                m.insert(
                    nick.to_string(),
                    Presence::Active {
                        uuid: uuid.unwrap_or("").to_string(),
                        count: 1,
                    },
                );
                Some(JoinKind::Fresh)
            }
            Some(Presence::Active { uuid: held, count }) => {
                if let Some(u) = uuid {
                    if held.as_str() != u {
                        return None;
                    }
                }
                *count += 1;
                Some(JoinKind::Additional)
            }
            Some(slot) => {
                let held: String = match slot {
                    Presence::Grace { uuid: h, .. } => h.clone(),
                    _ => unreachable!(),
                };
                if let Some(u) = uuid {
                    if held.as_str() != u {
                        return None;
                    }
                }
                let new_uuid = uuid.map(String::from).unwrap_or(held);
                let prior = std::mem::replace(
                    slot,
                    Presence::Active {
                        uuid: new_uuid,
                        count: 1,
                    },
                );
                if let Presence::Grace { cancel, .. } = prior {
                    let _ = cancel.send(());
                }
                Some(JoinKind::Resumed)
            }
        }
    }

    /// Called when a session ends. Returns `Some(rx)` iff this was the last
    /// active session for `nick` and we've transitioned to Grace — the caller
    /// should spawn a cleanup task that awaits either `rx` (resume) or the
    /// grace timeout.
    pub fn leave_member(&self, nick: &str) -> Option<oneshot::Receiver<()>> {
        let mut m = self.members.lock().unwrap();
        match m.get_mut(nick) {
            Some(Presence::Active { count, .. }) if *count > 1 => {
                *count -= 1;
                None
            }
            Some(Presence::Active { uuid, .. }) => {
                let uuid = uuid.clone();
                let (tx, rx) = oneshot::channel();
                m.insert(nick.to_string(), Presence::Grace { uuid, cancel: tx });
                Some(rx)
            }
            _ => None,
        }
    }

    /// Called by the grace cleanup task when the timeout wins. Returns true
    /// if we actually removed the nick (i.e. it was still in Grace).
    pub fn finalize_leave(&self, nick: &str) -> bool {
        let mut m = self.members.lock().unwrap();
        if matches!(m.get(nick), Some(Presence::Grace { .. })) {
            m.remove(nick);
            true
        } else {
            false
        }
    }

    pub fn member_list(&self) -> Vec<String> {
        let m = self.members.lock().unwrap();
        let mut list: Vec<String> = m.keys().cloned().collect();
        list.sort();
        list
    }
}

pub enum HistoryStore {
    Memory(Mutex<VecDeque<HistoryEntry>>),
    Valkey(MultiplexedConnection),
}

impl HistoryStore {
    pub async fn init() -> Self {
        match env::var("REDIS_URL") {
            Err(_) => {
                tracing::info!("REDIS_URL not set, using in-memory history");
                Self::memory()
            }
            Ok(url) => match redis::Client::open(url) {
                Err(e) => {
                    tracing::warn!(error = %e, "invalid REDIS_URL, using in-memory history");
                    Self::memory()
                }
                Ok(client) => match client.get_multiplexed_async_connection().await {
                    Ok(conn) => {
                        tracing::info!("connected to valkey, history is persistent");
                        Self::Valkey(conn)
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "valkey connection failed, using in-memory history");
                        Self::memory()
                    }
                },
            },
        }
    }

    fn memory() -> Self {
        Self::Memory(Mutex::new(VecDeque::with_capacity(HISTORY_CAP)))
    }

    pub async fn push(&self, entry: &HistoryEntry) {
        match self {
            Self::Memory(m) => {
                let mut h = m.lock().unwrap();
                if h.len() >= HISTORY_CAP {
                    h.pop_front();
                }
                h.push_back(entry.clone());
            }
            Self::Valkey(conn) => {
                let mut conn = conn.clone();
                let json = match serde_json::to_string(entry) {
                    Ok(j) => j,
                    Err(_) => return,
                };
                let push: redis::RedisResult<()> = conn.lpush(HISTORY_KEY, json).await;
                if let Err(e) = push {
                    tracing::warn!(error = %e, "valkey lpush failed");
                    return;
                }
                let trim: redis::RedisResult<()> =
                    conn.ltrim(HISTORY_KEY, 0, (HISTORY_CAP as isize) - 1).await;
                if let Err(e) = trim {
                    tracing::warn!(error = %e, "valkey ltrim failed");
                }
            }
        }
    }

    pub async fn list(&self) -> Vec<HistoryEntry> {
        match self {
            Self::Memory(m) => m.lock().unwrap().iter().cloned().collect(),
            Self::Valkey(conn) => {
                let mut conn = conn.clone();
                let items: Vec<String> = match conn
                    .lrange(HISTORY_KEY, 0, (HISTORY_CAP as isize) - 1)
                    .await
                {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(error = %e, "valkey lrange failed");
                        return Vec::new();
                    }
                };
                let mut out: Vec<HistoryEntry> = items
                    .iter()
                    .filter_map(|s| serde_json::from_str(s).ok())
                    .collect();
                // LPUSH puts newest at head; callers want oldest → newest.
                out.reverse();
                out
            }
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
