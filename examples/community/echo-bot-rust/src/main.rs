//! Echo Bot — Rust example for Rust Slack
//!
//! Connects via WebSocket, echoes messages, reacts to greetings.
//!
//! Usage:
//!   BOT_TOKEN=bot_xxx SERVER_URL=http://localhost:3000 cargo run

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Deserialize, Debug)]
struct WsTicketResponse {
    ticket: String,
}

#[derive(Deserialize, Debug)]
struct BotInfoResponse {
    bot_id: String,
    workspace_id: String,
    name: String,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum ServerEvent {
    #[serde(rename = "message.new")]
    MessageNew {
        channel_id: String,
        message_id: String,
        sender_id: String,
        sender_type: String,
        plaintext: Option<String>,
    },
    #[serde(rename = "typing.start")]
    TypingStart { channel_id: String, user_id: String },
    #[serde(rename = "presence.update")]
    PresenceUpdate { user_id: String, status: String },
    #[serde(other)]
    Other,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let token = std::env::var("BOT_TOKEN").expect("BOT_TOKEN required");
    let server = std::env::var("SERVER_URL").unwrap_or_else(|_| "http://localhost:3000".into());
    let client = reqwest::Client::new();

    // Get bot info
    let info: BotInfoResponse = client
        .get(format!("{server}/api/v1/auth/bot-info"))
        .bearer_auth(&token)
        .send().await?
        .json().await?;
    println!("[bot] {} starting (workspace: {})", info.name, info.workspace_id);

    // Get WS ticket
    let ticket: WsTicketResponse = client
        .post(format!("{server}/api/v1/auth/bot-ws-ticket"))
        .bearer_auth(&token)
        .send().await?
        .json().await?;

    // Connect WebSocket
    let ws_url = server.replace("http://", "ws://").replace("https://", "wss://");
    let (ws, _) = connect_async(format!("{ws_url}/api/v1/ws?ticket={}", ticket.ticket)).await?;
    let (mut write, mut read) = ws.split();
    println!("[bot] Connected to WebSocket");

    // Listen for events
    while let Some(Ok(msg)) = read.next().await {
        if let Message::Text(text) = msg {
            match serde_json::from_str::<ServerEvent>(&text) {
                Ok(ServerEvent::MessageNew { channel_id, sender_id, plaintext, sender_type, .. }) => {
                    // Skip own messages
                    if sender_id == info.bot_id { continue; }
                    if sender_type == "bot" { continue; }

                    if let Some(text) = plaintext {
                        println!("[msg] #{channel_id}: {text}");

                        // Echo it back
                        let reply = serde_json::json!({
                            "plaintext": format!("Echo: {text}"),
                            "content_type": "plaintext",
                            "sender_type": "bot"
                        });
                        let _ = client
                            .post(format!("{server}/api/v1/channels/{channel_id}/messages"))
                            .bearer_auth(&token)
                            .json(&reply)
                            .send().await;
                    }
                }
                Ok(ServerEvent::TypingStart { user_id, channel_id }) => {
                    println!("[typing] {user_id} in #{channel_id}");
                }
                _ => {}
            }
        }
    }

    println!("[bot] Disconnected");
    Ok(())
}
