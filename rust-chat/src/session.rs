use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{
    sink::SinkExt,
    stream::{SplitSink, SplitStream, StreamExt},
};

use crate::nick::{pick_nick, valid_nick};
use crate::state::{now_ms, AppState, ClientMessage, HistoryEntry, ServerMessage};

pub async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();

    let proposed = read_hello_nick(&mut receiver).await;
    let nick = match proposed {
        Some(n) if valid_nick(&n) => n,
        _ => pick_nick(&state.nick_counter),
    };

    let mut rx = state.tx.subscribe();
    state.add_member(&nick);
    let members = state.member_list();
    let history = state.history.list().await;

    tracing::info!(%nick, members = members.len(), "session start");

    // Greet just this client, including any backlog
    let welcome = ServerMessage::Welcome {
        nick: nick.clone(),
        members: members.clone(),
        history,
    };
    if send_msg(&mut sender, &welcome).await.is_err() {
        state.remove_member(&nick);
        return;
    }

    // Announce to everyone else
    let _ = state.tx.send(ServerMessage::Join {
        nick: nick.clone(),
        members,
    });

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
                            text: trimmed.to_string(),
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

    state.remove_member(&nick);
    let members = state.member_list();
    tracing::info!(%nick, members = members.len(), "session end");
    let _ = state.tx.send(ServerMessage::Leave { nick, members });
}

/// Wait up to 2 seconds for the client's Hello so we can honor a persisted
/// nick. Any failure or non-Hello returns `None`, and the caller falls back to
/// a generated name.
async fn read_hello_nick(receiver: &mut SplitStream<WebSocket>) -> Option<String> {
    let msg = tokio::time::timeout(Duration::from_secs(2), receiver.next())
        .await
        .ok()?
        ?
        .ok()?;
    let Message::Text(frame) = msg else {
        return None;
    };
    match serde_json::from_str::<ClientMessage>(&frame).ok()? {
        ClientMessage::Hello { nick } => nick,
        _ => None,
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
