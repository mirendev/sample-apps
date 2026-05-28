class_name NoteField
extends Node2D

## The rhythm core: the note chart, scheduling, tap judging, and all the
## gameplay drawing (lane, falling notes, hit ring, beat pulse). Timing comes
## from the Conductor. When inactive (title screen) it just draws a pulsing
## attract ring so you can see the room's beat before you tap in.

signal hit() ## a successful tap; main relays it to the conductor's room meter

const APPROACH_BEATS := 4.0   # how many beats a note is visible before its hit moment
const PERFECT_WINDOW := 0.16  # |beats off| for a Perfect
const GOOD_WINDOW := 0.36     # |beats off| for a Good; beyond this a tap whiffs / a note misses

const W := 720.0
const H := 1280.0
const HIT_Y := 980.0
const SPAWN_Y := -60.0
const LANE_X := W * 0.5
const NOTE_R := 38.0
const RING_R := 78.0
const APPROACH_GROW := 150.0 # how far out the contracting beat ring starts
const TITLE_RING_Y := 620.0

var active := false
var score := 0
var combo := 0
var best_combo := 0
var judgment := ""

var _conductor: Conductor
var _chart := [0.0, 2.0, 3.0, 4.0, 6.0, 7.0] # loop-local beats, repeats forever
var _notes: Array = []        # each: { "beat": float (absolute), "judged": bool }
var _scheduled_until := -1    # highest loop index we've spawned notes for
var _pulse := 0.0             # 0..1, flashes on each beat then decays
var _judgment_ttl := 0.0

func setup(conductor: Conductor) -> void:
	_conductor = conductor
	conductor.beat.connect(_on_beat)

## Begin gameplay. Schedule from the current beat so the player doesn't inherit
## a backlog of already-past notes.
func begin() -> void:
	active = true
	_scheduled_until = int(floor(_conductor.total_beats() / float(_conductor.beats_per_loop)))
	_notes.clear()

func judge() -> void:
	var ab := _conductor.total_beats()
	var best: Dictionary = {}
	var best_d := 9999.0
	for n in _notes:
		if n["judged"]:
			continue
		var d: float = absf(n["beat"] - ab)
		if d < best_d:
			best_d = d
			best = n

	if best.is_empty() or best_d > GOOD_WINDOW:
		# A whiff. Party-friendly: just resets the combo, no penalty, no shout.
		combo = 0
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
	_pulse = 1.0
	hit.emit()

func _on_beat(_loop_index: int) -> void:
	_pulse = 1.0

func _process(delta: float) -> void:
	var ab := _conductor.total_beats()

	if active:
		var need_loop := int(ceil((ab + APPROACH_BEATS) / float(_conductor.beats_per_loop)))
		_schedule_loops(need_loop)

		for n in _notes:
			if not n["judged"] and ab - n["beat"] > GOOD_WINDOW:
				n["judged"] = true
				_miss()

		_notes = _notes.filter(func(n): return not (n["judged"] and ab - n["beat"] > 1.0))

	_pulse = maxf(0.0, _pulse - delta * 5.0)
	if _judgment_ttl > 0.0:
		_judgment_ttl -= delta
		if _judgment_ttl <= 0.0:
			judgment = ""

	queue_redraw()

func _schedule_loops(up_to_loop: int) -> void:
	while _scheduled_until < up_to_loop:
		_scheduled_until += 1
		var base := _scheduled_until * _conductor.beats_per_loop
		for b in _chart:
			_notes.append({"beat": base + b, "judged": false})

func _miss() -> void:
	combo = 0
	_flash("MISS")

func _flash(text: String) -> void:
	judgment = text
	_judgment_ttl = 0.45

func _draw() -> void:
	draw_rect(Rect2(0, 0, W, H), Look.BG)
	var ab := _conductor.total_beats()

	if not active:
		_draw_beat_ring(Vector2(LANE_X, TITLE_RING_Y), ab)
		return

	draw_line(Vector2(LANE_X, 0), Vector2(LANE_X, H), Color(Look.DIM, 0.25), 2.0)
	draw_line(Vector2(0, HIT_Y), Vector2(W, HIT_Y), Look.DIM, 3.0)
	_draw_beat_ring(Vector2(LANE_X, HIT_Y), ab)

	for n in _notes:
		if n["judged"]:
			continue
		var rel: float = n["beat"] - ab
		if rel > APPROACH_BEATS or rel < -0.5:
			continue
		var y := lerpf(SPAWN_Y, HIT_Y, 1.0 - rel / APPROACH_BEATS)
		draw_circle(Vector2(LANE_X, y), NOTE_R, Look.NOTE)
		draw_arc(Vector2(LANE_X, y), NOTE_R, 0, TAU, 32, Color(Look.ACCENT, 0.6), 3.0)

# A ring that contracts to meet the target exactly on the beat, plus a bright
# pop on the beat itself — a precise "the beat is NOW" marker, handy for tuning
# the audio offset by eye against what you hear.
func _draw_beat_ring(center: Vector2, ab: float) -> void:
	var to_next := 1.0 - fposmod(ab, 1.0)        # 1 just after a beat, 0 at the next
	var ar := RING_R + to_next * APPROACH_GROW
	var a := 0.2 + 0.6 * (1.0 - to_next)         # brighter as it closes in
	draw_arc(center, ar, 0, TAU, 72, Color(Look.ACCENT, a), 5.0)
	draw_arc(center, RING_R, 0, TAU, 72, Look.DIM, 4.0)
	if _pulse > 0.0:
		draw_circle(center, RING_R, Color(Look.ACCENT, _pulse * 0.6))
