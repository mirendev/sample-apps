class_name MuteButton
extends Control

## A small, tappable speaker glyph that toggles the master audio bus. Drawn from
## primitives (no font/emoji) so it stays ASCII-safe and crisp at any scale. It
## doubles as the room's "sound is on" indicator: accent speaker with waves when
## live, a dim speaker with an X when muted. Self-contained — it reads and flips
## AudioServer state directly, so a keyboard shortcut can share the same toggle.

const SIZE := 56.0

func _ready() -> void:
	custom_minimum_size = Vector2(SIZE, SIZE)
	size = Vector2(SIZE, SIZE)
	mouse_filter = Control.MOUSE_FILTER_STOP

func _gui_input(event: InputEvent) -> void:
	var tapped := false
	if event is InputEventMouseButton:
		tapped = event.pressed and event.button_index == MOUSE_BUTTON_LEFT
	elif event is InputEventScreenTouch:
		tapped = event.pressed
	if tapped:
		toggle()
		accept_event() # eat it so gameplay's tap-to-judge doesn't also fire

func toggle() -> void:
	AudioServer.set_bus_mute(0, not AudioServer.is_bus_mute(0))
	queue_redraw()

func _draw() -> void:
	var muted := AudioServer.is_bus_mute(0)
	var col := Look.DIM if muted else Look.ACCENT

	# Tappable affordance: a faint disc so it reads as a button, not just an icon.
	var mid := Vector2(SIZE * 0.5, SIZE * 0.5)
	draw_circle(mid, SIZE * 0.5, Color(Look.DIM, 0.25))

	# Speaker silhouette (box + cone), pointing right. Nudged left of center to
	# leave room for the waves / mute-X on the right.
	var cx := SIZE * 0.38
	var cy := SIZE * 0.5
	var s := SIZE * 0.22 # half-height
	var body := PackedVector2Array([
		Vector2(cx - 1.7 * s, cy - 0.55 * s),
		Vector2(cx - 0.7 * s, cy - 0.55 * s),
		Vector2(cx + 0.3 * s, cy - 1.4 * s),
		Vector2(cx + 0.3 * s, cy + 1.4 * s),
		Vector2(cx - 0.7 * s, cy + 0.55 * s),
		Vector2(cx - 1.7 * s, cy + 0.55 * s),
	])
	draw_colored_polygon(body, col)

	if muted:
		var x0 := cx + 0.9 * s
		var x1 := cx + 2.0 * s
		var y0 := cy - 0.8 * s
		var y1 := cy + 0.8 * s
		draw_line(Vector2(x0, y0), Vector2(x1, y1), col, 3.0, true)
		draw_line(Vector2(x0, y1), Vector2(x1, y0), col, 3.0, true)
	else:
		var origin := Vector2(cx + 0.3 * s, cy)
		draw_arc(origin, 1.1 * s, -PI / 5.0, PI / 5.0, 14, col, 3.0, true)
		draw_arc(origin, 1.8 * s, -PI / 4.0, PI / 4.0, 18, col, 3.0, true)
