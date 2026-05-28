class_name ConductorClient
extends Node

## Talks to the rhythm-party conductor over WebSocket. Two jobs:
##   1. Clock sync (NTP-style): ping the server, measure round-trip, estimate the
##      offset between our wall clock and the server's, keep the best sample.
##   2. Relay the shared musical frame (epoch/bpm/loop) and the live party count.
##
## Gameplay never flows through here — only timing and ambient room state. If the
## socket never opens, nothing breaks: the Conductor just stays in solo mode.

signal synced(epoch: float, bpm: float, loop: int, offset: float, song_ms: float)
signal offset_updated(offset_ms: float)
signal party(online: int)

const PING_INTERVAL_SEC := 2.0

var _ws := WebSocketPeer.new()
var _connected := false
var _have_frame := false        # received a sync message
var _emitted_synced := false
var _best_rtt := INF
var _offset_ms := 0.0
var _ping_accum := 0.0
var _epoch_ms := 0.0
var _server_bpm := 124.0
var _server_loop := 8
var _song_ms := 0.0

func _ready() -> void:
	var url := _conductor_url()
	if url.is_empty():
		return
	var err := _ws.connect_to_url(url)
	if err != OK:
		push_warning("rhythm: WS connect to %s failed to start (err %d)" % [url, err])

func _process(delta: float) -> void:
	_ws.poll()
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not _connected:
				_connected = true
				_send_ping() # first sample immediately on open
			while _ws.get_available_packet_count() > 0:
				_handle(_ws.get_packet().get_string_from_utf8())
			_ping_accum += delta
			if _ping_accum >= PING_INTERVAL_SEC:
				_ping_accum = 0.0
				_send_ping()
		WebSocketPeer.STATE_CLOSED:
			if _connected:
				print("[rhythm] ws CLOSED code=", _ws.get_close_code(), " reason=", _ws.get_close_reason())
			_connected = false

func send_hit() -> void:
	if _connected:
		_ws.send_text(JSON.stringify({"t": "hit"}))

func _local_ms() -> float:
	return Time.get_unix_time_from_system() * 1000.0

func _send_ping() -> void:
	_ws.send_text(JSON.stringify({"t": "ping", "c": _local_ms()}))

func _handle(text: String) -> void:
	var msg = JSON.parse_string(text)
	if typeof(msg) != TYPE_DICTIONARY:
		return
	match str(msg.get("t", "")):
		"sync":
			_epoch_ms = float(msg.get("epoch", 0.0))
			_server_bpm = float(msg.get("bpm", _server_bpm))
			_server_loop = int(msg.get("loop_beats", _server_loop))
			_song_ms = float(msg.get("song_ms", 0.0))
			_have_frame = true
			_maybe_emit_synced()
		"pong":
			_absorb_pong(float(msg.get("c", 0.0)), float(msg.get("s", 0.0)))
		"party":
			party.emit(int(msg.get("online", 0)))

func _absorb_pong(c: float, s: float) -> void:
	var now := _local_ms()
	var rtt := now - c
	if rtt < 0.0:
		return
	# Keep the lowest-latency sample; its offset estimate is the most trustworthy.
	if rtt < _best_rtt:
		_best_rtt = rtt
		_offset_ms = s + rtt * 0.5 - now # server_now - local_now
		if _emitted_synced:
			offset_updated.emit(_offset_ms)
	_maybe_emit_synced()

func _maybe_emit_synced() -> void:
	if _emitted_synced:
		return
	if _have_frame and _best_rtt < INF:
		_emitted_synced = true
		synced.emit(_epoch_ms, _server_bpm, _server_loop, _offset_ms, _song_ms)

func _conductor_url() -> String:
	# In a web export, talk to whatever host served the page (same origin).
	if OS.has_feature("web"):
		var proto := str(JavaScriptBridge.eval("location.protocol", true))
		var host := str(JavaScriptBridge.eval("location.host", true))
		if not host.is_empty():
			var scheme := "wss" if proto == "https:" else "ws"
			return "%s://%s/ws" % [scheme, host]
	# Editor / desktop: talk to a locally-running conductor (no-op if absent).
	return "ws://127.0.0.1:3000/ws"
