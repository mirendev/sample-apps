# tailnet-hello

A proof of concept for putting a single Miren app on your
[tailnet](https://tailscale.com/). The app runs Tailscale inside its own
sandbox and joins your tailnet as its own machine,
`tailnet-hello.<your-tailnet>.ts.net`. The cluster it runs on doesn't need to
be on the tailnet at all.

Visit it from a device on your tailnet and it greets you by name. It can also
sit on the public internet at the same time, and it tells you which way you
came in.

> [!NOTE]
> Miren doesn't support per-app Tailscale natively (yet). This works by going
> *around* Miren: tailnet traffic reaches the sandbox directly and never
> passes through Miren's ingress. See [What you give up](#what-you-give-up)
> before building on it.

## How it works

The image carries the `tailscale` and `tailscaled` binaries next to the app,
copied from the official `tailscale/tailscale` image. `start.sh` brings
Tailscale up, then hands off to the app:

1. `tailscaled` starts in **userspace networking** mode. Sandboxes don't get
   `/dev/net/tun` or `NET_ADMIN`, and accepting connections doesn't need
   either.
2. `tailscale up` joins the tailnet using an auth key from a Miren secret.
3. `tailscale serve` terminates HTTPS on the machine's `ts.net` name and
   proxies plain HTTP to the app on `$PORT`. It also adds
   `Tailscale-User-Login` and `Tailscale-User-Name` headers for requests from
   people's devices. Tagged devices get no identity headers.

To the cluster, all of this is outbound UDP from a sandbox. WireGuard is
decrypted inside the sandbox, so Miren only ever sees encrypted packets.

`tailscaled` keeps its state on a local disk at `/var/lib/tailscale`. That's
what lets a redeploy come back as the same machine, with the same name,
address, and HTTPS certificate. Without the disk, every restart joins as a
brand-new machine. The old one is still registered for a while, so the new one
gets renamed `tailnet-hello-1` and needs a new certificate, and Let's Encrypt
only issues a handful of those per name each week.

## Deploying

You need a tailnet with
[HTTPS certificates](https://tailscale.com/kb/1153/enabling-https) turned on.

1. In the Tailscale admin console, generate an auth key that is **reusable**,
   **ephemeral**, and **tagged** (see [Locking it down](#locking-it-down)). If
   your tailnet requires device approval, make it **pre-approved** too.

2. Store it as a secret on your cluster. You'll be prompted for the value:

   ```bash
   miren secret set tailnet-hello/ts-authkey
   ```

3. Deploy:

   ```bash
   miren deploy
   ```

4. From a device on your tailnet, open
   `https://tailnet-hello.<your-tailnet>.ts.net`. The first request after a
   fresh start can take about 30 seconds while the certificate is issued.

With no route, the only way in is over the tailnet. The exception is when this
is the **only** app on the cluster: Miren makes the only app the default route,
which puts it on the cluster's public address too.

To rename the machine, change `TS_HOSTNAME` in `.miren/app.toml`.

## Locking it down

Tag the auth key (say, `tag:miren-app`) so the machine belongs to the tag
instead of to you. Then make sure your policy never lists that tag as a source.

This matters because the default tailnet policy lets `"*"` reach `"*:*"`, and
`"*"` includes tagged machines. Under that policy, an app on your tailnet can
reach everything else on it. Spell out who *can* start connections instead:

```jsonc
"acls": [
  {"action": "accept", "src": ["autogroup:member"], "dst": ["*:*"]},
],
"tagOwners": {
  "tag:miren-app": ["you@example.com"],
},
```

Your own devices can still reach the app, and the app can't start a
connection to anything.

## Going dual-homed

Give it a route and it's on the internet and your tailnet at once:

```bash
miren route set tailnet-hello.example.com tailnet-hello
```

The app tells the two paths apart by where the connection comes from, not by
headers. `tailscale serve` connects from loopback, and Miren's ingress
connects from the sandbox bridge. Anyone on the internet can send a
`Tailscale-User-Login` header, and the public ingress passes it along, so an
app that trusts those headers on every request can be fooled. `viaTailnet` in
`main.go` is the check to copy.

## What you give up

Everything Miren does to a request happens in its ingress, and tailnet traffic
never goes there. On the tailnet path you lose:

- **Scale-to-zero.** Miren wakes an idle app when a request arrives at the
  ingress, so a tailnet request can't wake it. This app runs a fixed single
  instance for that reason.
- **Multiple instances.** Instances on the same node would share the state
  directory, and with it one tailnet identity.
- **Route protection and the WAF.** `miren route protect` and WAF profiles
  only apply to ingress traffic. On the tailnet, your ACLs are the access
  control.
- **Ingress logs and metrics.** You see only what the app itself logs.

Reaching other tailnet machines *from* the app also takes extra work. In
userspace mode the app's own outbound traffic doesn't use the tailnet; point
it at tailscaled's SOCKS5 or HTTP proxy (`--socks5-server` /
`--outbound-http-proxy-listen`).
