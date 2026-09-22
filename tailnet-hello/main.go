package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
)

// tailscaled's LocalAPI listens on this socket (see start.sh). The host name
// in the URL is ignored for dialing, but tailscaled requires this exact value.
const tailscaledSock = "/tmp/tailscaled.sock"

var localAPI = &http.Client{
	Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", tailscaledSock)
		},
	},
}

type tailnetSelf struct {
	Tailnet string
	DNSName string
	IPs     []string
}

func whoAmI(ctx context.Context) (*tailnetSelf, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "http://local-tailscaled.sock/localapi/v0/status", nil)
	if err != nil {
		return nil, err
	}
	resp, err := localAPI.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var st struct {
		CurrentTailnet *struct{ Name string }
		Self           *struct {
			DNSName      string
			TailscaleIPs []string
		}
	}
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		return nil, err
	}
	if st.Self == nil {
		return nil, fmt.Errorf("tailscaled has no self node yet")
	}
	self := &tailnetSelf{
		DNSName: strings.TrimSuffix(st.Self.DNSName, "."),
		IPs:     st.Self.TailscaleIPs,
	}
	if st.CurrentTailnet != nil {
		self.Tailnet = st.CurrentTailnet.Name
	}
	return self, nil
}

// viaTailnet reports whether a request came in through `tailscale serve`,
// which proxies from loopback. Miren's ingress connects from the bridge, so
// anything else is public traffic, and any Tailscale-* headers on it are
// forged and must be ignored.
func viaTailnet(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if viaTailnet(r) {
			// tailscale serve only identifies people. Tagged devices (servers,
			// mostly) arrive with no identity headers at all.
			if login := r.Header.Get("Tailscale-User-Login"); login != "" {
				fmt.Fprintf(w, "hello, %s (%s)! you came in over the tailnet.\n",
					r.Header.Get("Tailscale-User-Name"), login)
			} else {
				fmt.Fprintln(w, "hello, tagged device! you came in over the tailnet.")
			}
		} else {
			fmt.Fprintln(w, "hello, internet! you came in through Miren's public ingress.")
		}

		self, err := whoAmI(r.Context())
		if err != nil {
			fmt.Fprintf(w, "\n(couldn't ask tailscaled who I am: %v)\n", err)
			return
		}
		fmt.Fprintf(w, "\nI'm also on the tailnet %s\n", self.Tailnet)
		fmt.Fprintf(w, "  as https://%s\n", self.DNSName)
		for _, ip := range self.IPs {
			fmt.Fprintf(w, "  at %s\n", ip)
		}
	})

	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
