extends Node2D

## Rhythm Party — step 1: offline prototype.
##
## Notes fall toward a hit line near the bottom; tap (space / click / touch) on
## the beat. Score and combo are local. There is no audio and no network yet —
## this exists to prove the game *feel* and the note/scoring skeleton before we
## bolt on the synced-room layer. The seams where the party layer plugs in are
## marked with `# PARTY:` below.

const APPROACH_BEATS := 4.0   # how many beats a note is visible before its hit moment
const PERFECT_WINDOW := 0.16  # |beats off| for a Perfect
const GOOD_WINDOW := 0.36     # |beats off| for a Good; beyond this a tap whiffs / a note misses

# Layout (matches the 720x1280 portrait viewport).
const W := 720.0
const H := 1280.0
const HIT_Y := 980.0
const SPAWN_Y := -60.0
const LANE_X := W * 0.5
const NOTE_R := 38.0
const RING_R := 78.0

# Miren accent, borrowed from rust-chat, so the family resemblance is visible.
const ACCENT := Color("#F6834B")
const BG := Color("#16161C")
const DIM := Color("#3A3A44")
const NOTE_COLOR := Color("#EDEDF2")

# The loop's note chart, in loop-local beats. Repeats every loop forever.
var chart := [0.0, 2.0, 3.0, 4.0, 6.0, 7.0]

var conductor: Conductor
var net: ConductorClient
var online := 0
var is_synced := false

var notes: Array = []        # each: { "beat": float (absolute), "judged": bool }
var scheduled_until := -1    # highest loop index we've spawned notes for

var score := 0
var combo := 0
var best_combo := 0
var pulse := 0.0             # 0..1, flashes on each beat then decays
var judgment := ""
var judgment_ttl := 0.0

var header_label: Label
var party_label: Label
var score_label: Label
var combo_label: Label
var judgment_label: Label
var hint_label: Label

var _net_grace := 0.0        # seconds since boot, for the "solo (offline)" fallback

func _ready() -> void:
	conductor = Conductor.new()
	add_child(conductor)
	conductor.beat.connect(_on_beat)

	header_label = _make_label(Vector2(0, 24), 34, HORIZONTAL_ALIGNMENT_CENTER)
	header_label.text = "RHYTHM PARTY"
	header_label.modulate = ACCENT

	# PARTY: this is where the live "37 here · room combo 182" count will go,
	# fed by the conductor's WebSocket "party" message. Solo for now.
	party_label = _make_label(Vector2(0, 66), 22, HORIZONTAL_ALIGNMENT_CENTER)
	party_label.text = "offline prototype · ♪ solo"
	party_label.modulate = DIM

	score_label = _make_label(Vector2(0, 140), 30, HORIZONTAL_ALIGNMENT_CENTER)
	combo_label = _make_label(Vector2(0, 184), 26, HORIZONTAL_ALIGNMENT_CENTER)
	combo_label.modulate = ACCENT

	judgment_label = _make_label(Vector2(0, HIT_Y - 220), 56, HORIZONTAL_ALIGNMENT_CENTER)

	hint_label = _make_label(Vector2(0, H - 70), 22, HORIZONTAL_ALIGNMENT_CENTER)
	hint_label.text = "tap space / click / touch on the beat"
	hint_label.modulate = DIM

	conductor.start()

	# Join the room. Harmless if there's no conductor reachable — the Conductor
	# just stays in solo mode and these signals never fire.
	net = ConductorClient.new()
	add_child(net)
	net.synced.connect(_on_synced)
	net.offset_updated.connect(func(o): conductor.set_offset(o))
	net.party.connect(_on_party)

func _make_label(pos: Vector2, size: int, align: int) -> Label:
	var l := Label.new()
	add_child(l)
	l.position = pos
	l.size = Vector2(W, size + 12)
	l.horizontal_alignment = align
	l.add_theme_font_size_override("font_size", size)
	return l

func _process(delta: float) -> void:
	_net_grace += delta
	var ab := conductor.total_beats()

	# Spawn notes far enough ahead that they enter at the top of the screen.
	var need_loop := int(ceil((ab + APPROACH_BEATS) / float(conductor.beats_per_loop)))
	_schedule_loops(need_loop)

	# A note the player let sail past the Good window is a miss.
	for n in notes:
		if not n["judged"] and ab - n["beat"] > GOOD_WINDOW:
			n["judged"] = true
			_register_miss()

	# Drop notes that are judged and safely behind us.
	notes = notes.filter(func(n): return not (n["judged"] and ab - n["beat"] > 1.0))

	pulse = maxf(0.0, pulse - delta * 3.5)
	if judgment_ttl > 0.0:
		judgment_ttl -= delta
		if judgment_ttl <= 0.0:
			judgment = ""

	_update_labels()
	queue_redraw()

func _schedule_loops(up_to_loop: int) -> void:
	while scheduled_until < up_to_loop:
		scheduled_until += 1
		var base := scheduled_until * conductor.beats_per_loop
		for b in chart:
			notes.append({ "beat": base + b, "judged": false })

func _on_beat(_loop_index: int) -> void:
	pulse = 1.0

func _on_synced(epoch: float, bpm: float, loop: int, offset: float) -> void:
	conductor.apply_server_sync(epoch, bpm, loop, offset)
	is_synced = true

func _on_party(n: int) -> void:
	online = n

func _unhandled_input(event: InputEvent) -> void:
	var tapped := false
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_SPACE:
		tapped = true
	elif event is InputEventScreenTouch and event.pressed:
		tapped = true
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		tapped = true
	if tapped:
		_judge_tap()

func _judge_tap() -> void:
	var ab := conductor.total_beats()
	var best: Dictionary = {}
	var best_d := 9999.0
	for n in notes:
		if n["judged"]:
			continue
		var d: float = absf(n["beat"] - ab)
		if d < best_d:
			best_d = d
			best = n

	if best.is_empty() or best_d > GOOD_WINDOW:
		# A whiff. Party-friendly: it just resets the combo, no score penalty.
		combo = 0
		_flash("…")
		return

	best["judged"] = true
	if best_d <= PERFECT_WINDOW:
		score += 100
		_flash("PERFECT")
	else:
		score += 50
		_flash("GOOD")
	combo += 1
	best_combo = maxi(best_combo, combo)
	pulse = 1.0
	# Feeds the room-wide energy meter (step 4); ignored by the conductor today.
	if net:
		net.send_hit()

func _register_miss() -> void:
	combo = 0
	_flash("MISS")

func _flash(text: String) -> void:
	judgment = text
	judgment_ttl = 0.45

func _update_labels() -> void:
	score_label.text = "%d" % score
	combo_label.text = ("combo %d" % combo) if combo > 0 else " "
	judgment_label.text = judgment
	judgment_label.modulate = ACCENT if judgment == "PERFECT" else Color.WHITE

	if is_synced:
		party_label.text = "🎉 %d here · everyone on the same beat" % maxi(online, 1)
		party_label.modulate = ACCENT
	elif _net_grace < 3.0:
		party_label.text = "connecting to the party…"
		party_label.modulate = DIM
	else:
		party_label.text = "solo (offline)"
		party_label.modulate = DIM

func _draw() -> void:
	draw_rect(Rect2(0, 0, W, H), BG)

	# Lane guide + hit line.
	draw_line(Vector2(LANE_X, 0), Vector2(LANE_X, H), Color(DIM, 0.25), 2.0)
	draw_line(Vector2(0, HIT_Y), Vector2(W, HIT_Y), DIM, 3.0)

	# Hit target, plus a beat pulse ring that expands and fades on each beat.
	draw_arc(Vector2(LANE_X, HIT_Y), RING_R, 0, TAU, 64, DIM, 4.0)
	if pulse > 0.0:
		draw_arc(Vector2(LANE_X, HIT_Y), RING_R + pulse * 46.0, 0, TAU, 64, Color(ACCENT, pulse), 6.0)

	# Falling notes.
	var ab := conductor.total_beats()
	for n in notes:
		if n["judged"]:
			continue
		var rel: float = n["beat"] - ab
		if rel > APPROACH_BEATS or rel < -0.5:
			continue
		var t := 1.0 - rel / APPROACH_BEATS
		var y := lerpf(SPAWN_Y, HIT_Y, t)
		draw_circle(Vector2(LANE_X, y), NOTE_R, NOTE_COLOR)
		draw_arc(Vector2(LANE_X, y), NOTE_R, 0, TAU, 32, Color(ACCENT, 0.6), 3.0)
