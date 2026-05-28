extends Node2D

## Orchestrator. Holds the TITLE/PLAYING state, wires the pieces together, and
## routes a tap to either "begin" or the note field. Everything substantive
## lives in its own component:
##   conductor.gd         the beat clock (solo, then server-synced)
##   conductor_client.gd  WebSocket clock-sync + party count
##   music_sync.gd        the track, pinned to the shared song position
##   note_field.gd        chart, scoring, and gameplay drawing
##   hud.gd               all the on-screen text

enum State { TITLE, PLAYING }

var state := State.TITLE
var conductor: Conductor
var net: ConductorClient
var music: MusicSync
var field: NoteField
var hud: Hud

var online := 0
var room_energy := 0.0
var is_synced := false
var _net_grace := 0.0 # seconds since boot, for the "solo (offline)" fallback

func _ready() -> void:
	conductor = Conductor.new()
	add_child(conductor)
	conductor.start()

	music = MusicSync.new()
	music.setup(conductor)
	add_child(music)

	field = NoteField.new()
	field.setup(conductor)
	field.hit.connect(_on_field_hit)
	add_child(field)

	hud = Hud.new()
	add_child(hud)

	# Join the room. Harmless if no conductor is reachable — the Conductor just
	# stays in solo mode and these signals never fire.
	net = ConductorClient.new()
	add_child(net)
	net.synced.connect(_on_synced)
	net.offset_updated.connect(func(o): conductor.set_offset(o))
	net.party.connect(_on_party)

func _process(delta: float) -> void:
	_net_grace += delta
	hud.set_party(is_synced, online, _net_grace < 3.0)
	hud.set_energy(room_energy)
	hud.set_offset_readout(conductor.audio_offset_ms)
	if state == State.PLAYING:
		hud.set_play_stats(field.score, field.combo, field.judgment)

func _on_synced(epoch: float, bpm: float, loop: int, offset: float, song_ms: float) -> void:
	conductor.apply_server_sync(epoch, bpm, loop, offset)
	music.configure(epoch, song_ms)
	is_synced = true

func _on_field_hit() -> void:
	if net:
		net.send_hit()

func _on_party(n: int, e: float) -> void:
	online = n
	room_energy = e

func _unhandled_input(event: InputEvent) -> void:
	# Live audio-offset calibration: [ earlier, ] later.
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_BRACKETLEFT:
			conductor.audio_offset_ms -= 10.0
			return
		if event.keycode == KEY_BRACKETRIGHT:
			conductor.audio_offset_ms += 10.0
			return
	if not _is_tap(event):
		return
	if state == State.TITLE:
		_begin_play()
	else:
		field.judge()

func _is_tap(event: InputEvent) -> bool:
	if event is InputEventKey:
		return event.pressed and not event.echo and event.keycode == KEY_SPACE
	if event is InputEventScreenTouch:
		return event.pressed
	if event is InputEventMouseButton:
		return event.pressed and event.button_index == MOUSE_BUTTON_LEFT
	return false

func _begin_play() -> void:
	state = State.PLAYING
	field.begin()
	music.begin()
	hud.set_title_mode(false)
