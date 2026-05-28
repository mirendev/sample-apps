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
4. **Ambient multiplayer** — room energy meter, shared across instances via managed Valkey. ✓ done
5. **Calibration + juice** — audio offset baked (26ms default); per-device tap-to-calibrate still open. ← *you are here*

**1.5: real audio** ✓ done — a title card (which also satisfies the browser's
"resume audio on a gesture" rule) starts "Brain Dance" by Kevin MacLeod, seeked
to the shared song position so the whole room hears the same moment, with drift
correction. The track is trimmed to exactly **440 beats** (55 eight-beat phrases)
so the loop is an integer number of beats — that's what keeps the note grid
locked to the music. (An integer beat grid against a non-integer-beat loop drifts
out of phase by an arbitrary, constant amount; that was the original "feels off"
bug.) A tunable audio offset — seeded from the platform's output latency, live
nudge with `[` and `]` — mops up the residual visual-vs-heard lag. A per-device
tap-to-calibrate is step 5.

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

# 4. (optional) attach managed Valkey so the room is shared across instances
miren addon create miren-valkey:small -a rhythm-party -C toys
```

The Valkey addon injects `REDIS_URL`. With it, the conductor runs in
*distributed mode*: hits fan out over a Valkey pub/sub channel so every
instance's energy meter rises, and presence is a shared counter — one room no
matter how many instances sit behind the route. Without it, the conductor falls
back to local single-instance mode and the game still works.

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
    main.gd          orchestrator: state, wiring, input routing
    conductor.gd     the beat clock — solo, or server-anchored once synced
    conductor_client.gd  WebSocket: clock-sync handshake + live party count
    music_sync.gd    the track, pinned to the shared song position
    note_field.gd    chart, scoring, and gameplay drawing
    hud.gd           all on-screen text
    look.gd          shared palette
    export_presets.cfg   the headless "Web" export preset
    assets/brain-dance.ogg   trimmed to a 440-beat loop (CC BY 4.0 — see Credits)
    icon.svg
  conductor/         Go server: serves the export + /ws (clock sync, energy, presence)
    main.go          static embed; /health; /ws hub; Valkey distributed mode
    go.mod, go.sum, vendor/   coder/websocket + go-redis, vendored for hermetic builds
    Procfile         web: /bin/app
    .miren/app.toml  app name + include = ["static"]
    static/          Godot web export — .gitignored, force-included via app.toml
```

## Credits

Music: "Brain Dance" by Kevin MacLeod (incompetech.com), licensed under
[Creative Commons: By Attribution 4.0](http://creativecommons.org/licenses/by/4.0/).
The in-game title card and footer carry the same credit.
