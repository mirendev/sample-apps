package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ---------------------------------------------------------------------------
// IRC data structures
// ---------------------------------------------------------------------------

const serverName = "miren-irc"

// ircClient represents one connection (TCP or WebSocket).
type ircClient struct {
	nick     string
	user     string
	realName string
	send     chan string
	quit     chan struct{}
	channels map[string]bool
	welcomed bool
}

// prefix returns the full IRC hostmask (nick!user@host).
func (c *ircClient) prefix() string {
	user := c.user
	if user == "" {
		user = c.nick
	}
	return c.nick + "!" + user + "@" + serverName
}

// trySend does a non-blocking send. If the client's buffer is full (stalled
// connection), it closes the quit channel to disconnect the client rather
// than blocking — this prevents a single slow client from deadlocking the
// entire server by holding s.mu.
func (c *ircClient) trySend(line string) {
	select {
	case c.send <- line:
	default:
		// Buffer full — disconnect the slow client.
		select {
		case <-c.quit:
		default:
			close(c.quit)
		}
	}
}

const historySize = 100

// historyEntry pairs an IRC line with the time it was sent.
type historyEntry struct {
	line string
	at   time.Time
}

// ircChannel represents an IRC channel.
type ircChannel struct {
	name    string
	members map[*ircClient]bool
	topic   string
	history []historyEntry // rolling buffer of recent IRC lines
}

func (ch *ircChannel) appendHistory(line string) {
	ch.history = append(ch.history, historyEntry{line: line, at: time.Now()})
	if len(ch.history) > historySize {
		ch.history = ch.history[len(ch.history)-historySize:]
	}
}

// server is the central IRC state machine. All mutations go through the
// event loop goroutine so no mutexes are needed on the maps themselves.
type server struct {
	clients  map[*ircClient]bool
	nickMap  map[string]*ircClient
	channels map[string]*ircChannel
	mu       sync.Mutex // protects all maps
}

func newServer() *server {
	return &server{
		clients:  make(map[*ircClient]bool),
		nickMap:  make(map[string]*ircClient),
		channels: make(map[string]*ircChannel),
	}
}

// ---------------------------------------------------------------------------
// IRC line parser
// ---------------------------------------------------------------------------

type ircMessage struct {
	prefix     string
	command    string
	params     []string
	serverTime string // IRCv3 @time tag value, if present
}

func parseIRCLine(line string) ircMessage {
	line = strings.TrimRight(line, "\r\n")
	var msg ircMessage

	// Parse IRCv3 message tags (@time=... )
	if strings.HasPrefix(line, "@") {
		tagEnd := strings.IndexByte(line, ' ')
		if tagEnd < 0 {
			return msg
		}
		tags := line[1:tagEnd]
		line = line[tagEnd+1:]
		for _, tag := range strings.Split(tags, ";") {
			if kv := strings.SplitN(tag, "=", 2); len(kv) == 2 && kv[0] == "time" {
				msg.serverTime = kv[1]
			}
		}
	}

	if strings.HasPrefix(line, ":") {
		parts := strings.SplitN(line[1:], " ", 2)
		msg.prefix = parts[0]
		if len(parts) > 1 {
			line = parts[1]
		} else {
			return msg
		}
	}

	if idx := strings.Index(line, " :"); idx >= 0 {
		trailing := line[idx+2:]
		line = line[:idx]
		parts := strings.Fields(line)
		if len(parts) > 0 {
			msg.command = strings.ToUpper(parts[0])
			msg.params = append(parts[1:], trailing)
		}
	} else {
		parts := strings.Fields(line)
		if len(parts) > 0 {
			msg.command = strings.ToUpper(parts[0])
			msg.params = parts[1:]
		}
	}

	return msg
}

func formatIRC(prefix, command string, params ...string) string {
	var b strings.Builder
	if prefix != "" {
		b.WriteString(":")
		b.WriteString(prefix)
		b.WriteString(" ")
	}
	b.WriteString(command)
	for i, p := range params {
		b.WriteString(" ")
		if i == len(params)-1 && (strings.Contains(p, " ") || strings.HasPrefix(p, ":") || p == "") {
			b.WriteString(":")
		}
		b.WriteString(p)
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// IRC command handlers
// ---------------------------------------------------------------------------

func (s *server) handleNick(c *ircClient, msg ircMessage) {
	if len(msg.params) < 1 {
		c.trySend(formatIRC(serverName, "431", "*", "No nickname given"))
		return
	}
	newNick := msg.params[0]
	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.nickMap[strings.ToLower(newNick)]; ok && existing != c {
		current := c.nick
		if current == "" {
			current = "*"
		}
		c.trySend(formatIRC(serverName, "433", current, newNick, "Nickname is already in use"))
		return
	}

	oldNick := c.nick
	if oldNick != "" {
		delete(s.nickMap, strings.ToLower(oldNick))
	}
	c.nick = newNick
	s.nickMap[strings.ToLower(newNick)] = c

	if oldNick != "" {
		// Broadcast nick change to all channels this user is in
		notification := formatIRC(oldNick+"!"+c.user+"@"+serverName, "NICK", newNick)
		notified := map[*ircClient]bool{c: true}
		c.trySend(notification)
		for chName := range c.channels {
			if ch, ok := s.channels[chName]; ok {
				for member := range ch.members {
					if !notified[member] {
						member.trySend(notification)
						notified[member] = true
					}
				}
			}
		}
	}

	s.tryWelcome(c)
}

func (s *server) handleUser(c *ircClient, msg ircMessage) {
	if len(msg.params) < 4 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c.user = msg.params[0]
	c.realName = msg.params[3]
	s.tryWelcome(c)
}

// tryWelcome sends RPL_WELCOME if both NICK and USER have been received.
// Must be called with s.mu held.
func (s *server) tryWelcome(c *ircClient) {
	if c.nick != "" && c.user != "" && !c.welcomed {
		c.welcomed = true
		c.trySend(formatIRC(serverName, "001", c.nick,
			fmt.Sprintf("Welcome to %s, %s!", serverName, c.nick)))
	}
}

func (s *server) handleJoin(c *ircClient, msg ircMessage) {
	if len(msg.params) < 1 {
		return
	}
	chanName := msg.params[0]
	if !strings.HasPrefix(chanName, "#") {
		chanName = "#" + chanName
	}
	chanName = strings.ToLower(chanName)

	s.mu.Lock()
	defer s.mu.Unlock()

	ch, ok := s.channels[chanName]
	if !ok {
		ch = &ircChannel{name: chanName, members: make(map[*ircClient]bool)}
		s.channels[chanName] = ch
	}

	if ch.members[c] {
		return // already in channel
	}

	ch.members[c] = true
	c.channels[chanName] = true

	// Replay recent history before broadcasting join, so the
	// joining client doesn't see their own JOIN twice.
	// Prepend IRCv3 @time tag so clients can show original timestamps.
	for _, entry := range ch.history {
		c.trySend("@time=" + entry.at.UTC().Format(time.RFC3339) + " " + entry.line)
	}

	joinMsg := formatIRC(c.prefix(), "JOIN", chanName)
	for member := range ch.members {
		member.trySend(joinMsg)
	}

	s.sendNames(c, ch)
}

func (s *server) handlePart(c *ircClient, msg ircMessage) {
	if len(msg.params) < 1 {
		return
	}
	chanName := strings.ToLower(msg.params[0])
	partMsg := ""
	if len(msg.params) > 1 {
		partMsg = msg.params[1]
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	ch, ok := s.channels[chanName]
	if !ok || !ch.members[c] {
		return
	}

	notification := formatIRC(c.prefix(), "PART", chanName, partMsg)
	for member := range ch.members {
		member.trySend(notification)
	}

	delete(ch.members, c)
	delete(c.channels, chanName)

	if len(ch.members) == 0 {
		delete(s.channels, chanName)
	}
}

func (s *server) handlePrivmsg(c *ircClient, msg ircMessage) {
	if len(msg.params) < 2 {
		return
	}
	target := strings.ToLower(msg.params[0])
	text := msg.params[1]

	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.HasPrefix(target, "#") {
		ch, ok := s.channels[target]
		if !ok {
			return
		}
		privmsg := formatIRC(c.prefix(), "PRIVMSG", target, text)
		for member := range ch.members {
			if member != c {
				member.trySend(privmsg)
			}
		}
		ch.appendHistory(privmsg)
	} else {
		// DM
		if recipient, ok := s.nickMap[target]; ok {
			recipient.trySend(formatIRC(c.prefix(), "PRIVMSG", recipient.nick, text))
		}
	}
}

func (s *server) handleQuit(c *ircClient, msg ircMessage) {
	quitMsg := "Quit"
	if len(msg.params) > 0 {
		quitMsg = msg.params[0]
	}
	s.removeClient(c, quitMsg)
}

func (s *server) removeClient(c *ircClient, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.clients[c] {
		return
	}
	delete(s.clients, c)
	if c.nick != "" {
		delete(s.nickMap, strings.ToLower(c.nick))
	}

	quitMsg := formatIRC(c.prefix(), "QUIT", reason)
	notified := make(map[*ircClient]bool)

	for chName := range c.channels {
		if ch, ok := s.channels[chName]; ok {
			delete(ch.members, c)
			for member := range ch.members {
				if !notified[member] {
					member.trySend(quitMsg)
					notified[member] = true
				}
			}
			if len(ch.members) == 0 {
				delete(s.channels, chName)
			}
		}
	}
	c.channels = nil

	select {
	case <-c.quit:
	default:
		close(c.quit)
	}
}

// sendNames sends RPL_NAMREPLY and RPL_ENDOFNAMES. Must hold s.mu.
func (s *server) sendNames(c *ircClient, ch *ircChannel) {
	var nicks []string
	for member := range ch.members {
		nicks = append(nicks, member.nick)
	}
	c.trySend(formatIRC(serverName, "353", c.nick, "=", ch.name, strings.Join(nicks, " ")))
	c.trySend(formatIRC(serverName, "366", c.nick, ch.name, "End of /NAMES list"))
}

func (s *server) registerClient(c *ircClient) {
	s.mu.Lock()
	s.clients[c] = true
	s.mu.Unlock()
}

func (s *server) dispatch(c *ircClient, msg ircMessage) {
	switch msg.command {
	case "NICK":
		s.handleNick(c, msg)
	case "USER":
		s.handleUser(c, msg)
	case "JOIN":
		s.handleJoin(c, msg)
	case "PART":
		s.handlePart(c, msg)
	case "PRIVMSG":
		s.handlePrivmsg(c, msg)
	case "PING":
		pong := "miren-irc"
		if len(msg.params) > 0 {
			pong = msg.params[0]
		}
		c.trySend(formatIRC(serverName, "PONG", serverName, pong))
	case "QUIT":
		s.handleQuit(c, msg)
	case "CAP":
		if len(msg.params) > 0 && strings.ToUpper(msg.params[0]) == "LS" {
			c.trySend(formatIRC(serverName, "CAP", "*", "LS", ""))
		}
		// CAP END and others are safe to ignore
	}
}

// ---------------------------------------------------------------------------
// TCP listener + client handler
// ---------------------------------------------------------------------------

func (s *server) serveTCP(addr string) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("TCP listen %s: %v", addr, err)
	}
	log.Printf("IRC listening on %s", addr)
	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Printf("TCP accept: %v", err)
			continue
		}
		go s.handleTCP(conn)
	}
}

func (s *server) handleTCP(conn net.Conn) {
	c := &ircClient{
		send:     make(chan string, 64),
		quit:     make(chan struct{}),
		channels: make(map[string]bool),
	}
	s.registerClient(c)

	// Writer goroutine
	go func() {
		for {
			select {
			case line := <-c.send:
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				_, err := fmt.Fprintf(conn, "%s\r\n", line)
				if err != nil {
					return
				}
			case <-c.quit:
				return
			}
		}
	}()

	// Reader
	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		msg := parseIRCLine(line)
		if msg.command == "" {
			continue
		}
		s.dispatch(c, msg)
		if msg.command == "QUIT" {
			break
		}
	}

	s.removeClient(c, "Connection closed")
	conn.Close()
}

// ---------------------------------------------------------------------------
// WebSocket bridge
// ---------------------------------------------------------------------------

const (
	wsPingInterval = 30 * time.Second
	wsPongTimeout  = 60 * time.Second
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// wsMessage is the JSON format for WebSocket communication.
type wsMessage struct {
	Type    string   `json:"type"`              // "message", "nick", "join", "part", "names", "system", "error"
	Nick    string   `json:"nick"`              // sender nick
	Content string   `json:"content,omitempty"` // message text or new nick
	Channel string   `json:"channel,omitempty"` // channel name
	Names   []string `json:"names,omitempty"`   // member list for "names" type
	Time    string   `json:"time,omitempty"`    // ISO 8601 timestamp (for history replay)
}

func (s *server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WS upgrade: %v", err)
		return
	}

	nick := r.URL.Query().Get("nick")
	if nick == "" {
		nick = fmt.Sprintf("user%d", rand.Intn(9000)+1000)
	}

	c := &ircClient{
		send:     make(chan string, 64),
		quit:     make(chan struct{}),
		channels: make(map[string]bool),
	}
	s.registerClient(c)

	// Set up ping/pong keepalive — the pong handler extends the read
	// deadline each time the browser responds.
	ws.SetReadDeadline(time.Now().Add(wsPongTimeout))
	ws.SetPongHandler(func(string) error {
		ws.SetReadDeadline(time.Now().Add(wsPongTimeout))
		return nil
	})

	// Start writer goroutine BEFORE dispatching commands, so the send
	// channel can drain (especially important with history replay).
	// Also sends periodic WebSocket pings to keep the connection alive.
	go func() {
		ticker := time.NewTicker(wsPingInterval)
		defer ticker.Stop()
		for {
			select {
			case line := <-c.send:
				var data []byte
				if strings.HasPrefix(line, "{") {
					// Already JSON (e.g. system messages), pass through
					data = []byte(line)
				} else {
					wsMsg := ircToWS(line, c.nick)
					if wsMsg == nil {
						continue
					}
					data, _ = json.Marshal(wsMsg)
				}
				ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := ws.WriteMessage(websocket.TextMessage, data); err != nil {
					return
				}
			case <-ticker.C:
				ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			case <-c.quit:
				return
			}
		}
	}()

	// Register the nick, user, and auto-join #miren
	s.dispatch(c, ircMessage{command: "NICK", params: []string{nick}})
	s.dispatch(c, ircMessage{command: "USER", params: []string{nick, "0", "*", nick}})
	s.dispatch(c, ircMessage{command: "JOIN", params: []string{"#miren"}})

	// Send initial connected message via the writer goroutine
	connMsg, _ := json.Marshal(wsMessage{Type: "system", Content: "Connected as " + nick, Nick: nick})
	c.trySend(string(connMsg))

	// Reader: WebSocket JSON → IRC commands
	for {
		_, raw, err := ws.ReadMessage()
		if err != nil {
			break
		}
		var msg wsMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "message":
			ch := msg.Channel
			if ch == "" {
				ch = "#miren"
			}
			s.dispatch(c, ircMessage{command: "PRIVMSG", params: []string{ch, msg.Content}})
			// Echo back to sender via the send channel
			echo, _ := json.Marshal(wsMessage{
				Type:    "message",
				Nick:    c.nick,
				Content: msg.Content,
				Channel: ch,
			})
			c.trySend(string(echo))
		case "nick":
			s.dispatch(c, ircMessage{command: "NICK", params: []string{msg.Content}})
		case "join":
			s.dispatch(c, ircMessage{command: "JOIN", params: []string{msg.Content}})
		case "part":
			s.dispatch(c, ircMessage{command: "PART", params: []string{msg.Content}})
		}
	}

	s.removeClient(c, "WebSocket closed")
	ws.Close()
}

// nickFromPrefix extracts the nick from a full IRC prefix (nick!user@host).
func nickFromPrefix(prefix string) string {
	if i := strings.IndexByte(prefix, '!'); i > 0 {
		return prefix[:i]
	}
	// Fallback: try to extract user part between ! and @
	if strings.HasPrefix(prefix, "!") {
		if j := strings.IndexByte(prefix, '@'); j > 1 {
			return prefix[1:j]
		}
	}
	return prefix
}

// ircToWS converts an IRC protocol line to a WebSocket JSON message.
func ircToWS(line, myNick string) *wsMessage {
	msg := parseIRCLine(line)
	nick := nickFromPrefix(msg.prefix)

	var result *wsMessage

	switch msg.command {
	case "PRIVMSG":
		if len(msg.params) >= 2 {
			result = &wsMessage{
				Type:    "message",
				Nick:    nick,
				Content: msg.params[1],
				Channel: msg.params[0],
			}
		}
	case "JOIN":
		ch := ""
		if len(msg.params) > 0 {
			ch = msg.params[0]
		}
		result = &wsMessage{
			Type:    "join",
			Nick:    nick,
			Channel: ch,
		}
	case "PART":
		ch := ""
		if len(msg.params) > 0 {
			ch = msg.params[0]
		}
		reason := ""
		if len(msg.params) > 1 {
			reason = msg.params[1]
		}
		result = &wsMessage{
			Type:    "part",
			Nick:    nick,
			Channel: ch,
			Content: reason,
		}
	case "QUIT":
		result = &wsMessage{
			Type:    "part",
			Nick:    nick,
			Content: "Quit",
		}
	case "NICK":
		if len(msg.params) > 0 {
			result = &wsMessage{
				Type:    "nick",
				Nick:    nick,
				Content: msg.params[0],
			}
		}
	case "353": // RPL_NAMREPLY
		if len(msg.params) >= 4 {
			names := strings.Fields(msg.params[3])
			result = &wsMessage{
				Type:    "names",
				Channel: msg.params[2],
				Names:   names,
			}
		}
	case "433": // Nick in use
		if len(msg.params) >= 3 {
			result = &wsMessage{
				Type:    "error",
				Content: msg.params[2],
			}
		}
	case "001":
		if len(msg.params) >= 2 {
			result = &wsMessage{
				Type:    "system",
				Content: msg.params[1],
			}
		}
	}

	if result != nil && msg.serverTime != "" {
		result.Time = msg.serverTime
	}
	return result
}

// ---------------------------------------------------------------------------
// HTTP server + embedded web UI
// ---------------------------------------------------------------------------

func (s *server) serveHTTP(addr string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(indexHTML))
	})

	log.Printf("HTTP listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("HTTP listen: %v", err)
	}
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	srv := newServer()
	go srv.serveTCP(":6667")
	srv.serveHTTP(":3000")
}

// ---------------------------------------------------------------------------
// Embedded HTML/CSS/JS web client
// ---------------------------------------------------------------------------

const indexHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>miren irc</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #1a1b26;
  --bg-alt: #24283b;
  --bg-highlight: #292e42;
  --fg: #c0caf5;
  --fg-dim: #565f89;
  --fg-bright: #c0caf5;
  --accent: #7aa2f7;
  --green: #9ece6a;
  --red: #f7768e;
  --yellow: #e0af68;
  --border: #3b4261;
  --input-bg: #1a1b26;
}

html, body { height: 100%; background: var(--bg); color: var(--fg); font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', 'Consolas', monospace; font-size: 14px; }

#app { display: flex; height: 100vh; }

/* Sidebar */
#sidebar { width: 200px; background: var(--bg-alt); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
#sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); }
#sidebar-header h2 { font-size: 14px; color: var(--accent); font-weight: 600; }
#channel-name { font-size: 13px; color: var(--fg-dim); margin-top: 4px; }
#members-header { padding: 12px 16px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-dim); }
#members { flex: 1; overflow-y: auto; padding: 0 8px; }
.member { padding: 4px 8px; border-radius: 4px; font-size: 13px; cursor: default; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.member:hover { background: var(--bg-highlight); }
.member.me { color: var(--accent); cursor: pointer; }

/* Chat area */
#chat { flex: 1; display: flex; flex-direction: column; min-width: 0; }

/* Messages */
#messages { flex: 1; overflow-y: auto; padding: 8px 16px; display: flex; flex-direction: column; }
.msg { padding: 2px 0; line-height: 1.5; word-wrap: break-word; }
.msg .time { color: var(--fg-dim); font-size: 12px; margin-right: 8px; }
.msg .nick { font-weight: 600; margin-right: 8px; }
.msg .text { }
.msg.system { color: var(--fg-dim); font-style: italic; }
.msg.system .nick { display: none; }
.msg.error { color: var(--red); }

/* Input */
#input-bar { padding: 12px 16px; border-top: 1px solid var(--border); display: flex; gap: 8px; }
#input-bar input { flex: 1; background: var(--input-bg); border: 1px solid var(--border); color: var(--fg); padding: 8px 12px; border-radius: 6px; font-family: inherit; font-size: 14px; outline: none; }
#input-bar input:focus { border-color: var(--accent); }
#input-bar input::placeholder { color: var(--fg-dim); }

/* Status bar */
#status { padding: 4px 16px; font-size: 11px; color: var(--fg-dim); border-top: 1px solid var(--border); background: var(--bg-alt); display: flex; justify-content: space-between; }
#status .connected { color: var(--green); }
#status .disconnected { color: var(--red); }

/* Scrollbar */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--fg-dim); }

/* Nick edit */
#nick-edit { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100; align-items: center; justify-content: center; }
#nick-edit.show { display: flex; }
#nick-edit-box { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 8px; padding: 24px; width: 300px; }
#nick-edit-box h3 { margin-bottom: 12px; font-size: 14px; color: var(--accent); }
#nick-edit-box input { width: 100%; background: var(--input-bg); border: 1px solid var(--border); color: var(--fg); padding: 8px 12px; border-radius: 6px; font-family: inherit; font-size: 14px; outline: none; }
#nick-edit-box input:focus { border-color: var(--accent); }
#nick-edit-box .hint { margin-top: 8px; font-size: 11px; color: var(--fg-dim); }

@media (max-width: 600px) {
  #sidebar { width: 150px; }
}
</style>
</head>
<body>
<div id="app">
  <div id="sidebar">
    <div id="sidebar-header">
      <h2>miren irc</h2>
      <div id="channel-name">#miren</div>
    </div>
    <div id="members-header">Members &mdash; <span id="member-count">0</span></div>
    <div id="members"></div>
  </div>
  <div id="chat">
    <div id="messages"></div>
    <div id="input-bar">
      <input id="msg-input" type="text" placeholder="Message #miren" autocomplete="off" autofocus>
    </div>
    <div id="status">
      <span id="conn-status" class="disconnected">Connecting...</span>
      <span id="nick-display"></span>
    </div>
  </div>
</div>

<div id="nick-edit">
  <div id="nick-edit-box">
    <h3>Change nickname</h3>
    <input id="nick-input" type="text" placeholder="New nickname" autocomplete="off">
    <div class="hint">Press Enter to confirm, Escape to cancel</div>
  </div>
</div>

<script>
(function() {
  const messagesEl = document.getElementById('messages');
  const membersEl = document.getElementById('members');
  const memberCountEl = document.getElementById('member-count');
  const msgInput = document.getElementById('msg-input');
  const connStatus = document.getElementById('conn-status');
  const nickDisplay = document.getElementById('nick-display');
  const nickEdit = document.getElementById('nick-edit');
  const nickInput = document.getElementById('nick-input');

  let ws = null;
  let myNick = '';
  let members = [];
  let reconnectDelay = 1000;

  // Deterministic nick color
  function nickColor(nick) {
    const colors = ['#7aa2f7','#9ece6a','#e0af68','#f7768e','#bb9af7','#7dcfff','#73daca','#ff9e64','#c0caf5','#2ac3de'];
    let hash = 0;
    for (let i = 0; i < nick.length; i++) hash = ((hash << 5) - hash + nick.charCodeAt(i)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }

  function timeStr(isoTime) {
    const d = isoTime ? new Date(isoTime) : new Date();
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  }

  function escapeHTML(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }

  function appendMessage(type, nick, content, isoTime) {
    const div = document.createElement('div');
    div.className = 'msg' + (type === 'system' || type === 'join' || type === 'part' || type === 'nick' ? ' system' : '') + (type === 'error' ? ' error' : '');

    let html = '<span class="time">' + timeStr(isoTime) + '</span>';

    if (type === 'message') {
      html += '<span class="nick" style="color:' + nickColor(nick) + '">' + escapeHTML(nick) + '</span>';
      html += '<span class="text">' + escapeHTML(content) + '</span>';
    } else if (type === 'join') {
      html += '<span class="text">' + escapeHTML(nick) + ' joined the channel</span>';
    } else if (type === 'part') {
      html += '<span class="text">' + escapeHTML(nick) + ' left the channel</span>';
    } else if (type === 'nick') {
      html += '<span class="text">' + escapeHTML(nick) + ' is now known as ' + escapeHTML(content) + '</span>';
    } else {
      html += '<span class="text">' + escapeHTML(content) + '</span>';
    }

    div.innerHTML = html;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateMembers(names) {
    members = names.slice().sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    memberCountEl.textContent = members.length;
    membersEl.innerHTML = '';
    members.forEach(function(n) {
      const div = document.createElement('div');
      div.className = 'member' + (n === myNick ? ' me' : '');
      div.textContent = n;
      div.style.color = nickColor(n);
      if (n === myNick) {
        div.title = 'Click to change nickname';
        div.addEventListener('click', showNickEdit);
      }
      membersEl.appendChild(div);
    });
  }

  function addMember(nick) {
    if (members.indexOf(nick) === -1) {
      members.push(nick);
      updateMembers(members);
    }
  }

  function removeMember(nick) {
    members = members.filter(function(n) { return n !== nick; });
    updateMembers(members);
  }

  function renameMember(oldNick, newNick) {
    members = members.map(function(n) { return n === oldNick ? newNick : n; });
    updateMembers(members);
  }

  function showNickEdit() {
    nickInput.value = myNick;
    nickEdit.classList.add('show');
    nickInput.focus();
    nickInput.select();
  }

  nickInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const newNick = nickInput.value.trim();
      if (newNick && newNick !== myNick && ws) {
        ws.send(JSON.stringify({ type: 'nick', content: newNick }));
      }
      nickEdit.classList.remove('show');
      msgInput.focus();
    } else if (e.key === 'Escape') {
      nickEdit.classList.remove('show');
      msgInput.focus();
    }
  });

  nickEdit.addEventListener('click', function(e) {
    if (e.target === nickEdit) {
      nickEdit.classList.remove('show');
      msgInput.focus();
    }
  });

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const savedNick = localStorage.getItem('irc-nick') || '';
    const params = savedNick ? '?nick=' + encodeURIComponent(savedNick) : '';
    ws = new WebSocket(proto + '//' + location.host + '/ws' + params);

    ws.onopen = function() {
      connStatus.textContent = 'Connected';
      connStatus.className = 'connected';
      reconnectDelay = 1000;
    };

    ws.onmessage = function(e) {
      let msg;
      try { msg = JSON.parse(e.data); } catch(_) { return; }

      var t = msg.time; // undefined for live messages, ISO string for history
      switch (msg.type) {
        case 'message':
          appendMessage('message', msg.nick, msg.content, t);
          break;
        case 'join':
          appendMessage('join', msg.nick, '', t);
          addMember(msg.nick);
          break;
        case 'part':
          appendMessage('part', msg.nick, msg.content, t);
          removeMember(msg.nick);
          break;
        case 'nick':
          if (msg.nick === myNick) {
            myNick = msg.content;
            nickDisplay.textContent = myNick;
            localStorage.setItem('irc-nick', myNick);
          }
          appendMessage('nick', msg.nick, msg.content, t);
          renameMember(msg.nick, msg.content);
          break;
        case 'names':
          updateMembers(msg.names || []);
          break;
        case 'system':
          appendMessage('system', '', msg.content, t);
          if (msg.nick) {
            myNick = msg.nick;
            nickDisplay.textContent = myNick;
            localStorage.setItem('irc-nick', myNick);
          }
          break;
        case 'error':
          appendMessage('error', '', msg.content, t);
          break;
      }
    };

    ws.onclose = function() {
      connStatus.textContent = 'Disconnected. Reconnecting...';
      connStatus.className = 'disconnected';
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
  }

  msgInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const text = msgInput.value.trim();
      if (!text || !ws) return;
      msgInput.value = '';

      // Handle /nick command
      if (text.startsWith('/nick ')) {
        const newNick = text.slice(6).trim();
        if (newNick) {
          ws.send(JSON.stringify({ type: 'nick', content: newNick }));
        }
        return;
      }

      ws.send(JSON.stringify({ type: 'message', content: text, channel: '#miren' }));
    }
  });

  connect();
})();
</script>
</body>
</html>`
