class_name Hud
extends Control

## All the on-screen text: title card (header / intro / "tap to start"), the
## live party count, the in-game score / combo / judgment, and the music credit.
## main drives it; the Hud just renders state.

const W := 720.0
const H := 1280.0
const HIT_Y := 980.0
const BAR_W := W - 80.0 # room-energy meter width

var _titling := true
var _blink := 0.0

var _header: Label
var _party: Label
var _intro: Label
var _start: Label
var _sound: Label
var _mute: MuteButton
var _score: Label
var _combo: Label
var _judgment: Label
var _hint: Label
var _credit: Label
var _offset: Label
var _energy_bg: ColorRect
var _energy_fill: ColorRect

func _ready() -> void:
	_header = _label(Vector2(0, 56), 44, "RHYTHM PARTY", Look.ACCENT)
	_party = _label(Vector2(0, 120), 24, "", Look.DIM)

	_intro = _label(Vector2(40, 470), 27, "", Color.WHITE)
	_intro.size = Vector2(W - 80, 280)
	_intro.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_intro.text = ("Everyone here is playing the same track, on the same beat, "
		+ "at the same time.\n\nTap the ring on the beat. Bop with the room.")

	_start = _label(Vector2(0, 770), 34, "tap to start", Look.ACCENT)
	_sound = _label(Vector2(0, 824), 22, "sound on - turn your volume up", Look.DIM)

	_score = _label(Vector2(0, 150), 34, "", Color.WHITE)
	_combo = _label(Vector2(0, 196), 26, "", Look.ACCENT)
	_judgment = _label(Vector2(0, HIT_Y - 210), 56, "", Color.WHITE)

	_hint = _label(Vector2(0, H - 78), 20, "tap on the beat   (M to mute)", Look.DIM)
	_credit = _label(Vector2(0, H - 40), 15,
		"Music: \"Brain Dance\" by Kevin MacLeod (incompetech.com), CC BY 4.0", Look.DIM)
	_offset = _label(Vector2(0, H - 108), 15, "", Look.DIM)

	# Room-energy meter: a thin strip across the very top that fills as the room
	# hits. Lives above everything else so it never collides with score/notes.
	_energy_bg = ColorRect.new()
	add_child(_energy_bg)
	_energy_bg.position = Vector2(40, 14)
	_energy_bg.size = Vector2(BAR_W, 8)
	_energy_bg.color = Color(Look.DIM, 0.5)
	_energy_fill = ColorRect.new()
	add_child(_energy_fill)
	_energy_fill.position = Vector2(40, 14)
	_energy_fill.size = Vector2(0, 8)
	_energy_fill.color = Look.ACCENT

	# Persistent sound toggle, top-right under the energy strip. Present in both
	# title and play, so the room can mute (or confirm sound is on) at any time.
	_mute = MuteButton.new()
	add_child(_mute)
	_mute.position = Vector2(W - MuteButton.SIZE - 16, 32)

	set_title_mode(true)

func set_title_mode(on: bool) -> void:
	_titling = on
	_intro.visible = on
	_start.visible = on
	_sound.visible = on
	_score.visible = not on
	_combo.visible = not on
	_judgment.visible = not on
	_hint.visible = not on
	_offset.visible = not on

func set_party(is_synced: bool, online: int, connecting: bool) -> void:
	if is_synced:
		_party.text = "%d here, all on the same beat" % maxi(online, 1)
		_party.modulate = Look.ACCENT
	elif connecting:
		_party.text = "connecting to the party..."
		_party.modulate = Look.DIM
	else:
		_party.text = "solo (offline)"
		_party.modulate = Look.DIM

func toggle_mute() -> void:
	_mute.toggle()

func set_offset_readout(ms: float) -> void:
	_offset.text = "audio offset %d ms  ( [ / ] )" % int(round(ms))

func set_energy(e: float) -> void:
	_energy_fill.size = Vector2(clampf(e, 0.0, 1.0) * BAR_W, 8.0)

func set_play_stats(score: int, combo: int, judgment: String) -> void:
	_score.text = "%d" % score
	_combo.text = ("combo %d" % combo) if combo > 0 else " "
	_judgment.text = judgment
	_judgment.modulate = Look.ACCENT if judgment == "PERFECT" else Color.WHITE

func _process(delta: float) -> void:
	_blink += delta
	if _titling:
		_start.modulate = Color(Look.ACCENT, 0.45 + 0.55 * (0.5 + 0.5 * sin(_blink * 5.0)))

func _label(pos: Vector2, size: int, text: String, color: Color) -> Label:
	var l := Label.new()
	add_child(l)
	l.position = pos
	l.size = Vector2(W, size + 12)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_size_override("font_size", size)
	l.text = text
	l.modulate = color
	return l
