# TrapHawk brand kit (working)

Sharp-Quant aesthetic: near-black ink, signal amber, monospace terminal type.

## Palette

| Role | Hex |
|---|---|
| Tile / background ink | #0d0d0f |
| Signal amber (primary) | #f5a524 |
| Amber mid step (bar 2) | #b5802a |
| Amber dark step (bar 1) | #7a5c1e |
| Baseline gray | #52525b |
| Wordmark off-white | #e7e5e4 |
| Muted gray (taglines) | #71717a |

Opacity equivalents on the tile: the mid and dark ambers are #f5a524 at 0.65 and 0.4.

Site-side signal colors for reference: positive = amber #f5a524, negative = the signal red used by text-signal-neg in the app theme.

## Type

- JetBrains Mono throughout the brand marks.
- Wordmark: 700 weight, letter-spacing 2. "TRAP" in amber, "HAWK" in off-white.
- Tagline: 13px, letter-spacing 5.5, muted gray, all caps: EVERY PICK ON THE HOUSE LEDGER.

## Geometry conventions

- Mark tile: 240 x 240, corner radius 28, ink fill.
- Lockup tile: 640 x 180, corner radius 12.
- Bars: flat horizontal tops, slight rightward lean, ascending dark to bright left to right.

## Machine-readable base (bars + baseline, no hawk)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <rect width="240" height="240" rx="28" fill="#0d0d0f"/>
  <rect x="38" y="192" width="170" height="9" fill="#52525b"/>
  <polygon points="54,188 88,188 96,146 62,146"   fill="#7a5c1e"/>
  <polygon points="100,188 134,188 142,112 108,112" fill="#b5802a"/>
  <polygon points="146,188 180,188 188,54 154,54"  fill="#f5a524"/>
</svg>
```

Logo mark itself: Vince is building it (his design, his tools). When it lands, derive favicon.svg, OG image, and the lockup from it using the conventions above.
