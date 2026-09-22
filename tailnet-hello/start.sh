#!/bin/sh
set -e

SOCK=/tmp/tailscaled.sock

# Userspace networking: sandboxes have no /dev/net/tun or NET_ADMIN, and we
# don't need either to accept connections.
#
# State lives on the app's disk, so the node keeps its identity, its name, and
# its HTTPS cert across restarts and redeploys. That's safe because Miren
# never runs two sandboxes that share a disk at once: a deploy drains the old
# one before starting the new one.
tailscaled --tun=userspace-networking \
  --statedir=/var/lib/tailscale --socket="$SOCK" &

tailscale --socket="$SOCK" up \
  --auth-key="$TS_AUTHKEY" \
  --hostname="${TS_HOSTNAME:-tailnet-hello}"

# Terminate HTTPS on the node's ts.net name and proxy to the app.
tailscale --socket="$SOCK" serve --bg "http://127.0.0.1:${PORT:-3000}"

exec /usr/local/bin/tailnet-hello
