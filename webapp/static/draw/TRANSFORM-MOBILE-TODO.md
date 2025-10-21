Love this question. Here’s a tight, mobile-first interaction plan that stays minimal but powerful—no code, just patterns you can pick from.

# How to enter/exit Transform (no keyboard)

* **Hold-to-Transform button (modifier):** A small thumb-reachable “✥ Transform” pill (bottom corner). **Press & hold** = temporarily repurpose gestures for the active layer; **release** = back to drawing. Zero mode toggling, super fast.
* **One-tap toggle:** Tap the same pill to **lock** Transform mode; tap again or tap outside to exit.
* **Layer row shortcut:** Tap an active layer’s thumbnail/name to enter Transform; tap again to exit.
* **Two-finger double-tap** (on canvas): quick toggle Transform (optional; teach with a hint once).

# Gesture vocabulary inside Transform

* **1-finger drag** (inside bounds): move layer (grab).
* **Pinch** (two fingers) on the layer: scale around pinch midpoint.
* **Two-finger rotate**: rotate around midpoint; show subtle rotation arc.
* **Edge/corner handles (optional, minimal):** Corner = uniform scale; edge = non-uniform scale; outside-corner drag = rotate (classic DCC pattern).
* **Double-tap**: reset rotation to 0° (or fit to canvas if done on a corner).
* **Long-press** on any point: set **pivot** (shows a small crosshair).

# Snapping & precision (feels pro, still simple)

* **Smart snapping:** gentle haptics at 0°, 90°, 180°, common scales (25/50/100%), and centerlines.
* **Second-finger modifier:** While dragging with one finger, **touch with a second finger** to constrain:
  – horizontal/vertical move,
  – uniform scaling if you’re on an edge handle,
  – snap rotation to 15° steps.
* **Nudge joystick:** Tiny on-screen “D-pad” bubble appears near your thumb in Transform for pixel nudges (auto-hides).

# Avoid conflicts with viewport pan/zoom

* **Clear separation:** Canvas two-finger pinch/scroll continues to pan/zoom the **viewport** only when **not** in Transform.
  In Transform mode (or while holding the modifier), pinches/rotations affect the **layer** instead.
* **Visual state:** When Transform is active, show a faint bounding box + pivot; hide brush overlay so it’s obvious you’re transforming, not painting.

# Quick actions (bottom sheet or small HUD)

A tiny strip when Transform is active:

* **Flip H / V**, **+90° / −90°**, **Fit to canvas**, **Center layer**.
* **Opacity** slider (already supported per-layer—nice to have it here).
* **Cancel / Apply**: large, thumb-reachable ✓ and ↩︎. Auto-apply on inactivity (e.g., 1–2s after last gesture) if that matches your app’s vibe.

# Selection & multi-select (later, if you want)

* **Tap to select layer** on canvas (hit-testing alpha).
* **Lasso** gesture (press-hold, then draw) to select multiple layers; then transform as a group.

# Discoverability (lightweight)

* **First-use toast**: “Hold ✥ to transform the active layer.”
* **Micro demo** (3s GIF-like overlay) once, then never again.
* **Haptics** at snaps for learn-by-feel.

# Accessibility & ergonomics

* **Thumb zones:** Let users anchor the ✥ pill left or right; keep big touch targets (≥44 px).
* **Haptics + subtle sound** for apply/cancel and snaps.
* **One-handed reach:** place Confirm/Cancel near the transform pill.

# Edge cases & safety

* **Lock aspect for images by default** (corner = uniform); enable non-uniform via edge handle or second-finger modifier.
* **Prevent accidental transforms:** require either the **modifier hold** or the **explicit mode toggle**.
* **Performance hint:** While transforming, draw a **proxy** (lower-res) texture and swap back to full-res on Apply for silky FPS on older phones.

# Nice extras (if you have time)

* **Context wheel:** Long-press the ✥ pill opens a radial with Move / Scale / Rotate / Warp (future).
* **Pivot presets:** Tap pivot icon to cycle (center, corners, last-tap).
* **Reset layer**: long-press Apply button to “Bake & reset pivot to center”.

This gives you a minimal, learnable system:

* quick **hold-to-transform** for power users,
* clear **mode** for everyone else,
* conflict-free gestures,
* great feedback (snaps/haptics),
* and just a tiny HUD for the essentials.
