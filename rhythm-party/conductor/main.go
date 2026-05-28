// The rhythm-party conductor.
//
// Right now it does exactly one job: serve the Godot web export. That's all we
// need to put the game on Miren and join it from a phone. The synced-room layer
// (a /ws WebSocket endpoint + Valkey for the shared beat anchor and room stats)
// lands here next, in the same binary, so it's one app and one `miren deploy`.
package main

import (
	"embed"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
)

//go:embed all:static
var staticFS embed.FS

func main() {
	// Some minimal images for .wasm don't know this type, and the browser needs
	// it to stream-compile the module.
	_ = mime.AddExtensionType(".wasm", "application/wasm")

	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.Handle("/", crossOriginIsolation(http.FileServer(http.FS(sub))))

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	log.Printf("rhythm-party conductor listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

// crossOriginIsolation sets COOP/COEP when CROSS_ORIGIN_ISOLATION is set. The
// current single-threaded (nothreads) web export does NOT need these, so they're
// off by default to keep mobile browsers happy. The moment we switch to a
// threaded export (which wants SharedArrayBuffer), flip this env var on.
func crossOriginIsolation(next http.Handler) http.Handler {
	if os.Getenv("CROSS_ORIGIN_ISOLATION") == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		next.ServeHTTP(w, r)
	})
}
