use std::collections::{HashMap, VecDeque};
use std::env;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use redis::{aio::MultiplexedConnection, AsyncCommands};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

const HISTORY_CAP: usize = 200;
const HISTORY_KEY: &str = "chat:history";

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
    Hello { nick: Option<String> },
    Send { text: String },
}

pub struct AppState {
    pub tx: broadcast::Sender<ServerMessage>,
    pub nick_counter: AtomicU64,
    pub page: String,
    pub history: HistoryStore,
    pub members: Mutex<HashMap<String, u32>>,
}

impl AppState {
    pub fn add_member(&self, nick: &str) {
        let mut m = self.members.lock().unwrap();
        *m.entry(nick.to_string()).or_insert(0) += 1;
    }

    pub fn remove_member(&self, nick: &str) {
        let mut m = self.members.lock().unwrap();
        if let Some(c) = m.get_mut(nick) {
            *c = c.saturating_sub(1);
            if *c == 0 {
                m.remove(nick);
            }
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
