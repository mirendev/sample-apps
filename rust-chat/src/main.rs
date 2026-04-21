mod nick;
mod session;
mod state;

use std::collections::HashMap;
use std::env;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use axum::extract::{State, WebSocketUpgrade};
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::Router;
use tokio::sync::broadcast;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

use nick::seed_counter;
use state::{AppState, HistoryStore, ServerMessage};

const PAGE_TEMPLATE: &str = include_str!("../templates/index.html");

#[tokio::main]
async fn main() {
    init_tracing();

    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let title = env::var("ROOM_TITLE").unwrap_or_else(|_| "rust-chat".to_string());
    let welcome = env::var("WELCOME_MESSAGE")
        .unwrap_or_else(|_| "A Rust + tokio + axum app running on Miren.".to_string());
    let accent = env::var("ACCENT_COLOR").unwrap_or_else(|_| "#F6834B".to_string());
    let version = env::var("MIREN_VERSION").unwrap_or_else(|_| "dev".to_string());

    let (tx, _rx) = broadcast::channel::<ServerMessage>(256);
    let state = Arc::new(AppState {
        tx,
        nick_counter: AtomicU64::new(seed_counter()),
        page: render_page(&title, &welcome, &accent, &version),
        history: HistoryStore::init().await,
        members: Mutex::new(HashMap::new()),
    });

    let app = Router::new()
        .route("/", get(index))
        .route("/ws", get(ws_handler))
        .route("/health", get(|| async { "ok\n" }))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!(%addr, "listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

fn init_tracing() {
    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")));

    let console_layer = env::var("TOKIO_CONSOLE").ok().map(|_| {
        console_subscriber::ConsoleLayer::builder()
            .server_addr(std::net::SocketAddr::from(([0, 0, 0, 0], 6669)))
            .spawn()
    });

    tracing_subscriber::registry()
        .with(console_layer)
        .with(fmt_layer)
        .init();

    if env::var("TOKIO_CONSOLE").is_ok() {
        tracing::info!("tokio-console enabled on 0.0.0.0:6669");
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};
        if let Ok(mut stream) = signal(SignalKind::terminate()) {
            stream.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    tracing::info!("shutdown signal received");
}

async fn index(State(state): State<Arc<AppState>>) -> Html<String> {
    Html(state.page.clone())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| session::handle_socket(socket, state))
}

fn render_page(title: &str, welcome: &str, accent: &str, version: &str) -> String {
    PAGE_TEMPLATE
        .replace("__TITLE__", title)
        .replace("__WELCOME__", welcome)
        .replace("__ACCENT__", accent)
        .replace("__VERSION__", version)
}
