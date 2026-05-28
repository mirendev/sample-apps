# Rhythm Party

A globally-synced rhythm game built for PIGCon 2026, showing off Miren as an
indie game backend. Everyone who scans the QR is playing the *same looped track
on the same beat at the same time*. Join the party, head-bop with the room.

The point of the demo, beyond being fun at a booth, is that the backend is
small, legible, and entirely yours: the kind of thing an indie dev looks at and
goes "oh, I could do this for my game too." Background and the full landscape
analysis live in the `neighborhood` repo:
`analysis/indie-game-backends-pigcon-2026.md`.

## The trick: sync the clock, not the inputs

Nobody syncs gameplay. The server is a conductor that broadcasts when the loop
started and at what BPM, and every client computes its own beat position from a
shared sense of "now" (an NTP-style offset handshake on connect). No collision,
no authority, no netcode rabbit hole. A latecomer who scans the QR mid-song
drops straight into the correct phase, in sync with the room, automatically.

That choice is concentrated in one place: `Conductor._now()` in
`game/conductor.gd`. Today it reads the local engine clock (solo play). It
becomes audio playback position (step 1.5), then `local clock + server offset`
(step 3). The gameplay never changes.

## Shape of the whole thing (where we're headed)

One Miren app does three jobs, which is the cleanest possible deploy story:

```
  phone (QR) ──┐   Miren app "rhythm-party"
  phone (QR) ──┤    GET /     → Godot web export (this game)
  phone (QR) ──┤    GET /ws   → conductor (WebSocket) ──► managed Valkey
               ┘                                          (track anchor,
                                                           online count,
                                                           room combo,
                                                           pub/sub fan-out)
```

Serving the game's static files and the WebSocket from the same binary means no
CORS, no second domain, no "configure your API base URL" papercut. One
`miren deploy`, one URL on the sticker. It's almost exactly the shape of the
`rust-chat` sample (axum + WebSocket + Valkey), which is the proven path we're
standing on while we diverge at the game layer.

## Build order

We front-load the risky questions ("is it fun?", "does web export behave?")
ahead of the multiplayer, which is low-risk precisely because it's clock-sync,
not netcode.

1. **Offline client** — loop, tap, score locally. ✓ done
2. **Web export, hosted static on Miren** — QR-joinable, no install. ✓ done, live at https://rhythm.miren.toys
3. **WebSocket + clock sync** — every client on the same server-anchored beat, plus a live party count. ✓ done (handshake verified in prod: ~15ms RTT)
4. **Ambient multiplayer** — room-wide energy/combo meter, shared visualizer (and managed Valkey for cross-instance stats). ← *you are here*
5. **Calibration + juice** — tap-to-calibrate on join, polish the feel.

In between 1 and 2 there's a **1.5: real audio**, anchoring the beat clock to an
actual looping track instead of the bare engine clock.

## Running step 1

With a display: install [Godot 4.4+](https://godotengine.org/download) (standard
build, no C# needed), open the `game/` folder as a project in the editor, and
press **F5**. Notes fall to the hit line; tap **space**, click, or touch on the
beat.

There's no audio yet — step 1 is deliberately silent, proving the note movement,
the scoring windows, and the feel. The beat is visual (the pulsing ring). Real
music lands in step 1.5, at which point the timing source moves from the engine
clock to the audio playback position.

## Headless / Nix dev box

There's a flake here, and `.envrc` loads it via direnv when Nix is present (it
no-ops on machines without Nix). `direnv allow` puts `godot`, `gdlint`, and the
web export templates on your PATH. A headless box can do most of the loop —
everything but actually *seeing* the pixels:

```sh
gdlint game/*.gd                                    # static GDScript lint
godot --headless --path game --import               # import assets / build cache
godot --headless --path game --quit-after 8         # run; surfaces any script errors
```

The web export (step 2) also runs headless via `godot --headless --export-release Web`,
using the templates from `godot-export-templates-bin` (exposed as
`$GODOT_EXPORT_TEMPLATES`). That's how we'll produce the static files the Miren
conductor serves.

## Deploying to Miren

The conductor is a tiny Go server that embeds the web export and serves it (plus
`/health`). The whole app is one `miren deploy`. From `rhythm-party/`:

```sh
# 1. (re)build the web export into conductor/static/
godot --headless --path game --export-release "Web" conductor/static/index.html

# 2. deploy the conductor (the Go buildpack embeds static/ at build time)
miren deploy -C toys -d conductor

# 3. point a hostname at it (first time only)
miren route set rhythm.miren.toys rhythm-party -C toys
```

`conductor/static/` is a ~43MB build artifact, so it's `.gitignored`. But Miren
honors `.gitignore` when bundling a deploy, so `.miren/app.toml` carries
`include = ["static"]` to force it back into the build context. That's the knob:
gitignore the blob, re-include it for the deploy.

One gotcha worth knowing: a stale `miren` client (pre-#803 / MIR-1135) uploads
this ~43MB at a crawl. Keep your client recent — the batching fix turns a
40-minute upload into a sub-second one.

## Layout

```
rhythm-party/
  game/              Godot project (the client)
    project.godot
    main.tscn        one node, script-attached; the tree is built in code
    main.gd          gameplay, scoring, drawing
    conductor.gd     the beat clock — solo, or server-anchored once synced
    conductor_client.gd  WebSocket: clock-sync handshake + live party count
    export_presets.cfg   the headless "Web" export preset
    icon.svg
  conductor/         Go server: serves the export + /ws (clock sync, presence)
    main.go          static embed; /health; /ws hub + clock-sync; opt-in COOP/COEP
    go.mod, go.sum, vendor/   coder/websocket, vendored for hermetic builds
    Procfile         web: /bin/app
    .miren/app.toml  app name + include = ["static"]
    static/          Godot web export — .gitignored, force-included via app.toml
```
