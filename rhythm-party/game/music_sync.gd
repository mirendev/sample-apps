class_name MusicSync
extends Node

## Owns the music and keeps it pinned to the room's shared song position.
##
## The track loops; every client seeks to the same point derived from server
## time, so the whole room hears the same moment. Playback can only START after
## a user gesture (browser autoplay policy), which the title card provides via
## begin(). A periodic drift check re-seeks if the audio clock wanders.

const DRIFT_RESEEK_SEC := 0.12 # tolerated gap between audio and server song-position
# Trimmed to exactly 440 beats (55 eight-beat phrases) so the loop is an integer
# number of beats — that's what keeps notes locked to the music. See the README.
const TRACK := "res://assets/brain-dance.ogg"

var _conductor: Conductor
var _player := AudioStreamPlayer.new()
var _epoch_ms := 0.0
var _song_ms := 0.0
var _started := false
var _drift_accum := 0.0

func setup(conductor: Conductor) -> void:
	_conductor = conductor

func _ready() -> void:
	add_child(_player)
	var stream := load(TRACK)
	if stream is AudioStreamOggVorbis:
		stream.loop = true
	_player.stream = stream

## Learn the shared anchor + loop length. If we're already playing (the player
## tapped in before sync arrived), snap to the room's position.
func configure(epoch_ms: float, song_ms: float) -> void:
	_epoch_ms = epoch_ms
	_song_ms = song_ms
	if _started and _player.playing:
		_player.seek(_song_pos_sec())

## Start playback (call from a user gesture), seeked to the shared position.
func begin() -> void:
	if _started or _player.stream == null:
		return
	_started = true
	_player.play(_song_pos_sec())

func _process(delta: float) -> void:
	if not _started or _song_ms <= 0.0 or not _player.playing:
		return
	_drift_accum += delta
	if _drift_accum < 2.0:
		return
	_drift_accum = 0.0
	var ln := _song_ms / 1000.0
	var d := _song_pos_sec() - _player.get_playback_position()
	d = fposmod(d + ln * 0.5, ln) - ln * 0.5 # wrap into [-ln/2, ln/2]
	if absf(d) > DRIFT_RESEEK_SEC:
		_player.seek(_song_pos_sec())

func _song_pos_sec() -> float:
	if _song_ms <= 0.0 or _conductor == null:
		return 0.0
	return fposmod(_conductor.server_now_ms() - _epoch_ms, _song_ms) / 1000.0
