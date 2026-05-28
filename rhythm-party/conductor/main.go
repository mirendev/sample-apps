// The rhythm-party conductor.
//
// Two jobs:
//  1. Serve the Godot web export (so the game is one URL on a sticker).
//  2. Conduct the room over /ws: hand every client a shared sense of "now" and
//     a fixed beat anchor, so they all land on the same downbeat without ever
//     syncing a single gameplay input.
//
// The anchor is a constant epoch, not server state: beat phase is just
// (now - epoch) % loop. That means every instance computes the same beat from
// its (NTP-synced) wall clock, so this scales horizontally with no shared
// store. Managed Valkey enters later only for cross-instance room stats.
package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

//go:embed all:static
var staticFS embed.FS

// The shared musical frame. The client adopts these from the sync message, so
// this is the single source of truth for tempo and loop length.
const (
	anchorEpochMs = int64(1735689600000) // 2025-01-01T00:00:00Z, an arbitrary fixed downbeat
	bpm           = 124.0                // "Brain Dance" by Kevin MacLeod
	loopBeats     = 8                    // note ostinato repeats every 8 beats
	songLenMs     = int64(212903)        // 440 beats — integer loop so notes lock to the music
)

func nowMs() int64 { return time.Now().UnixMilli() }

func main() {
	_ = mime.AddExtensionType(".wasm", "application/wasm")

	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}

	h := newHub()
	go h.tickPresence(3 * time.Second)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/ws", h.serveWS)
	mux.Handle("/", crossOriginIsolation(http.FileServer(http.FS(sub))))

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	log.Printf("rhythm-party conductor listening on :%s (bpm=%g loop=%d)", port, bpm, loopBeats)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

// --- the room ---------------------------------------------------------------

type client struct {
	conn *websocket.Conn
	send chan any // buffered; the writer goroutine owns all writes
}

// trySend never blocks and never panics — a slow or gone client just drops the
// update. The channel is never closed; the writer exits on ctx cancellation.
func (c *client) trySend(v any) {
	select {
	case c.send <- v:
	default:
	}
}

type hub struct {
	mu      sync.Mutex
	clients map[*client]struct{}
}

func newHub() *hub { return &hub{clients: map[*client]struct{}{}} }

func (h *hub) add(c *client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *hub) remove(c *client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
}

func (h *hub) broadcast(v any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		c.trySend(v)
	}
}

func (h *hub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

func (h *hub) tickPresence(every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for range t.C {
		h.broadcast(partyMsg{T: "party", Online: h.count()})
	}
}

// --- messages ---------------------------------------------------------------

type clientMsg struct {
	T string `json:"t"`           // "ping" | "hit"
	C int64  `json:"c,omitempty"` // client send time (ms) for ping round-trip
}

type pongMsg struct {
	T string `json:"t"` // "pong"
	C int64  `json:"c"` // echoed client time
	S int64  `json:"s"` // server now (ms)
}

type syncMsg struct {
	T         string  `json:"t"` // "sync"
	Epoch     int64   `json:"epoch"`
	BPM       float64 `json:"bpm"`
	LoopBeats int     `json:"loop_beats"`
	SongMs    int64   `json:"song_ms"` // music loop length; clients loop the track here
}

type partyMsg struct {
	T      string `json:"t"` // "party"
	Online int    `json:"online"`
}

// --- websocket --------------------------------------------------------------

func (h *hub) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"}, // public game, beat sync is read-only
	})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	ctx := r.Context()
	c := &client{conn: conn, send: make(chan any, 32)}
	h.add(c)
	defer func() {
		h.remove(c)
		h.broadcast(partyMsg{T: "party", Online: h.count()})
	}()

	// Greet with the shared musical frame and the current head count.
	c.trySend(syncMsg{T: "sync", Epoch: anchorEpochMs, BPM: bpm, LoopBeats: loopBeats, SongMs: songLenMs})
	h.broadcast(partyMsg{T: "party", Online: h.count()})

	// Writer goroutine: the only place we touch conn.Write.
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case v := <-c.send:
				wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
				err := wsjson.Write(wctx, conn, v)
				cancel()
				if err != nil {
					conn.CloseNow()
					return
				}
			}
		}
	}()

	// Reader loop: clock-sync pings (and hits, in step 4).
	for {
		var m clientMsg
		if err := wsjson.Read(ctx, conn, &m); err != nil {
			return
		}
		switch m.T {
		case "ping":
			c.trySend(pongMsg{T: "pong", C: m.C, S: nowMs()})
		case "hit":
			// step 4: aggregate into a room-wide combo/energy meter.
		}
	}
}

func crossOriginIsolation(next http.Handler) http.Handler {
	if _, err := strconv.ParseBool(os.Getenv("CROSS_ORIGIN_ISOLATION")); err != nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		next.ServeHTTP(w, r)
	})
}
