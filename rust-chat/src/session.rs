use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{
    sink::SinkExt,
    stream::{SplitSink, SplitStream, StreamExt},
};
use rustrict::CensorStr;

use crate::nick::{pick_nick, valid_nick};
use crate::state::{
    now_ms, AppState, ClientMessage, HistoryEntry, JoinKind, ServerMessage, GRACE_PERIOD,
};

pub async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();

    let (proposed_nick, proposed_uuid) = read_hello(&mut receiver).await;
    // New clients persist a UUID in localStorage and send it with Hello; the
    // server uses it to distinguish multi-tab / grace resumes from collisions
    // by a stranger. Legacy clients (cached pre-UUID HTML) don't send one —
    // `join_member` falls back to the old loose-match behavior for them.
    let uuid = proposed_uuid.as_deref();

    let mut rx = state.tx.subscribe();
    let (nick, join_kind) = match proposed_nick {
        Some(n) if valid_nick(&n) => match state.join_member(&n, uuid) {
            Some(jk) => (n, jk),
            None => {
                // Proposed nick is held by a different uuid — reassign.
                tracing::info!(%n, "proposed nick collides with a different uuid, reassigning");
                let nick = state.claim_fresh_nick(uuid, || pick_nick(&state.nick_counter));
                (nick, JoinKind::Fresh)
            }
        },
        _ => {
            let nick = state.claim_fresh_nick(uuid, || pick_nick(&state.nick_counter));
            (nick, JoinKind::Fresh)
        }
    };
    let members = state.member_list();
    let history = state.history.list().await;

    tracing::info!(
        %nick,
        members = members.len(),
        resumed = matches!(join_kind, JoinKind::Resumed),
        "session start"
    );

    // Greet just this client, including any backlog
    let welcome = ServerMessage::Welcome {
        nick: nick.clone(),
        members: members.clone(),
        history,
    };
    if send_msg(&mut sender, &welcome).await.is_err() {
        end_session(&state, &nick).await;
        return;
    }

    // Announce to everyone else only when the room hasn't already seen this
    // nick (fresh join, not a resume or additional tab).
    if matches!(join_kind, JoinKind::Fresh) {
        let _ = state.tx.send(ServerMessage::Join {
            nick: nick.clone(),
            members,
        });
    }

    // Forward broadcasts to this client; also heartbeat with Ping every 30s
    let mut send_task = tokio::spawn(async move {
        let mut ping = tokio::time::interval(Duration::from_secs(30));
        ping.tick().await; // skip the immediate first tick
        loop {
            tokio::select! {
                msg = rx.recv() => match msg {
                    Ok(m) => {
                        if send_msg(&mut sender, &m).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                },
                _ = ping.tick() => {
                    if sender.send(Message::Ping(Vec::new().into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Read from this client, broadcast chats
    let state_for_recv = state.clone();
    let nick_for_recv = nick.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(frame) => {
                    if let Ok(ClientMessage::Send { text }) = serde_json::from_str(&frame) {
                        let trimmed = text.trim();
                        if trimmed.is_empty() || trimmed.len() > 500 {
                            continue;
                        }
                        let entry = HistoryEntry {
                            nick: nick_for_recv.clone(),
                            text: trimmed.censor(),
                            ts: now_ms(),
                        };
                        state_for_recv.history.push(&entry).await;
                        let _ = state_for_recv.tx.send(ServerMessage::Chat {
                            nick: entry.nick,
                            text: entry.text,
                            ts: entry.ts,
                        });
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // When either side finishes, stop the other and announce leave
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }

    end_session(&state, &nick).await;
}

/// Hand the nick back to presence tracking. If this was the last active
/// session for `nick`, `leave_member` flips it to Grace and hands us a
/// receiver; we spawn a cleanup task that either resumes silently (cancel
/// fires first) or broadcasts Leave when the grace period elapses.
async fn end_session(state: &Arc<AppState>, nick: &str) {
    let Some(cancel_rx) = state.leave_member(nick) else {
        tracing::info!(%nick, "session end (other tabs still connected)");
        return;
    };

    tracing::info!(%nick, grace_secs = GRACE_PERIOD.as_secs(), "session end, grace started");

    let state = state.clone();
    let nick = nick.to_string();
    tokio::spawn(async move {
        tokio::select! {
            _ = cancel_rx => {
                tracing::info!(%nick, "grace cancelled by resume");
            }
            _ = tokio::time::sleep(GRACE_PERIOD) => {
                if state.finalize_leave(&nick) {
                    let members = state.member_list();
                    tracing::info!(%nick, "grace expired, announcing leave");
                    let _ = state.tx.send(ServerMessage::Leave { nick, members });
                }
            }
        }
    });
}

/// Wait up to 2 seconds for the client's Hello so we can honor a persisted
/// nick and uuid. Any failure or non-Hello yields `(None, None)`.
async fn read_hello(
    receiver: &mut SplitStream<WebSocket>,
) -> (Option<String>, Option<String>) {
    let msg = match tokio::time::timeout(Duration::from_secs(2), receiver.next()).await {
        Ok(Some(Ok(m))) => m,
        _ => return (None, None),
    };
    let Message::Text(frame) = msg else {
        return (None, None);
    };
    match serde_json::from_str::<ClientMessage>(&frame).ok() {
        Some(ClientMessage::Hello { nick, uuid }) => (nick, uuid),
        _ => (None, None),
    }
}

async fn send_msg(
    sender: &mut SplitSink<WebSocket, Message>,
    msg: &ServerMessage,
) -> anyhow::Result<()> {
    let text = serde_json::to_string(msg)?;
    sender.send(Message::Text(text.into())).await?;
    Ok(())
}
