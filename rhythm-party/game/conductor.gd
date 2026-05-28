class_name Conductor
extends Node

## The beat clock. Everything in the game derives its timing from here.
##
## The whole multiplayer trick lives in _now(): right now it reads the local
## engine clock (solo play). To go from solo to a synced room you swap the time
## source, NOT the gameplay:
##
##   offline    -> Time.get_ticks_usec()                       (this file, today)
##   with audio -> AudioStreamPlayer.get_playback_position()   (step 1.5)
##   networked  -> local clock + offset from the server        (step 3)
##
## Nobody ever syncs inputs. The server just hands out a shared sense of "now"
## and an anchor for when the loop started, and every client computes its own
## beat position. That's why there's no netcode rabbit hole.

signal beat(loop_index: int) ## fires once per whole beat; loop_index is 0..beats_per_loop-1

## How many beats of countdown before the first note, so the player isn't
## ambushed at t=0 and the opening note has time to travel down the screen.
const LEAD_IN_BEATS := 4.0

@export var bpm: float = 124.0
@export var beats_per_loop: int = 8

## Audio is heard a little after its logical position (output latency, plus any
## track lead-in). This shifts the visual/judging clock to match what you hear,
## without moving the audio itself. Positive = compensate for later audio.
## Default hand-tuned on a Mac/Chrome setup; per-device calibration is step 5.
## Tunable live with [ and ].
var audio_offset_ms := 26.0

var _running := false
var _start_sec := 0.0
var _last_whole_beat := -9999

# Server-synced mode. Once the ConductorClient finishes its clock-sync
# handshake, total_beats() switches from the local solo clock to global server
# time, so every client lands on the same downbeat.
var _synced := false
var _epoch_ms := 0.0
var _offset_ms := 0.0

func start() -> void:
	# Anchor "beat zero" LEAD_IN_BEATS into the future, so total_beats() counts
	# up from a negative countdown. Later this anchor comes from the server.
	_start_sec = _now() + LEAD_IN_BEATS * seconds_per_beat()
	_running = true
	_last_whole_beat = -9999

func seconds_per_beat() -> float:
	return 60.0 / bpm

## Switch from solo timing to the room's shared beat. Called once when the
## ConductorClient finishes its clock-sync handshake.
func apply_server_sync(epoch: float, new_bpm: float, loop: int, offset: float) -> void:
	_epoch_ms = epoch
	bpm = new_bpm
	beats_per_loop = loop
	_offset_ms = offset
	_synced = true

## Refresh just the clock offset; later handshake samples correct for drift.
func set_offset(offset_ms: float) -> void:
	_offset_ms = offset_ms

func is_synced() -> bool:
	return _synced

## Global server wall-clock in ms (local clock + measured offset). Used to keep
## music playback aligned to the same song position for everyone.
func server_now_ms() -> float:
	return Time.get_unix_time_from_system() * 1000.0 + _offset_ms

## Absolute beats since "beat zero". When synced, derived from global server
## time; otherwise from the local solo clock (negative during the lead-in).
func total_beats() -> float:
	var off := audio_offset_ms / 1000.0 / seconds_per_beat()
	if _synced:
		var server_now_ms := Time.get_unix_time_from_system() * 1000.0 + _offset_ms
		return (server_now_ms - _epoch_ms) / 1000.0 / seconds_per_beat() - off
	if not _running:
		return 0.0
	return (_now() - _start_sec) / seconds_per_beat() - off

## Position within the current loop, 0..beats_per_loop.
func loop_beat() -> float:
	return fposmod(total_beats(), float(beats_per_loop))

func _process(_delta: float) -> void:
	if not _running and not _synced:
		return
	var wb := int(floor(total_beats()))
	if wb != _last_whole_beat:
		_last_whole_beat = wb
		beat.emit(posmod(wb, beats_per_loop))

# --- the one seam that becomes "server time" later -------------------------
func _now() -> float:
	return float(Time.get_ticks_usec()) / 1_000_000.0
