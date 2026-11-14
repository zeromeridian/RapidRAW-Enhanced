# Orbit Blend Pad: How It Works

This guide explains everything the Orbit Blend Pad does, in plain words
with worked examples. It describes ThisIsRAW `1.54.0`. The pad is on the
**Orbit** tab of the Develop panel, below the Favorites star.

## The idea in one paragraph

You put a few tools on the edge of a shape, for example Contrast at the
top and Saturation at the bottom left, and give each tool a value. Then
you drag one point, the **puck**, around inside the shape. Wherever the
puck is, every tool adds some amount to its own slider at the same time.
Close to a tool's dot you get that tool's full value. At the centre you
get nothing. On the far side of the centre you get the opposite. So one
drag changes several sliders together, and you can look for a mood by
moving a single point instead of setting five sliders.

## The parts of the pad

| Part | What it is |
|---|---|
| **Shape** | The outline: circle, triangle, square, rectangle, pentagon or hexagon. |
| **Tool dot** | A small white dot on the edge, with the tool's name next to it. Each dot is one tool (one slider). |
| **Puck** | The large white dot inside the shape. It is the only thing you drag to blend. |
| **Centre cross** | The small cross in the middle. With the puck there, the pad changes nothing. |
| **Opposite ring** | A small faint ring on the far edge, straight across from each tool dot, through the centre. It marks where the tool gives its full opposite. |
| **Colour glow** | Each tool tints its half of the shape: warm towards the side where it adds, cool towards the side where it takes away. |
| **Label** | Under each tool's name: the value the tool gives *now* (accent colour), then its value *at the dot* (small, grey, after an arrow). |

## How one tool works

Every tool has a **line**: from its dot, through the centre, to its
opposite ring. Only the puck's position *along that line* matters. Moving
the puck sideways, across the line, does not change what that tool does.

The tool's **value at the dot** (the slider in the tool's card) is what it
gives when the puck sits on the dot. Everywhere else it gives a share of
that value:

- **On the dot:** the full value.
- **Halfway between centre and dot:** half of it (with the Linear curve).
- **At the centre:** nothing.
- **Halfway towards the opposite ring:** half of it, reversed.
- **On the opposite ring:** the full value, reversed.

### Example 1: one tool

Contrast sits at the top of a circle, value at the dot +60, Linear curve,
Amount 100.

| Where the puck is | Contrast added |
|---|---|
| On the Contrast dot (top) | +60 |
| Halfway up | +30 |
| Centre | 0 |
| Halfway down | −30 |
| Bottom edge (Contrast's opposite ring) | −60 |
| Halfway up but far to the right | +30 (only the height along Contrast's line counts) |

### Example 2: several tools at once

A new pad has three tools, evenly spaced: Contrast +60 at the top,
Temperature +50 at the bottom right, Saturation −60 at the bottom left.
Drag the puck all the way to the top:

| Tool | Where the puck is on that tool's line | Added |
|---|---|---|
| Contrast | on the dot | +60 |
| Temperature | halfway towards its opposite ring | −25 (half of +50, reversed) |
| Saturation | halfway towards its opposite ring | +30 (half of −60, reversed) |

Moving towards one tool always moves the others too, along their own
lines. That is intended: the pad blends.

### Example 3: why "Whites −80" can brighten the photo

Whites sits at the bottom left with the value −80 at its dot. The puck is
at the top right, close to Whites' opposite ring. There the tool gives the
**reverse** of −80, so it *adds* Whites (about +75 with the Soft curve) and
the photo gets brighter. Set the value at the dot to +86 instead and the
same puck position gives about −81, so the photo gets darker.

The label shows this directly: "now +75 → −80" means the tool gives +75
right now, and would give −80 with the puck on its dot. If you never want a
tool to do the reverse, switch its **Reverse** off (see below).

## Tool settings (one card per tool)

| Setting | What it does |
|---|---|
| **Tool** | Which slider the tool moves. Changing it keeps the same *share* of the slider's range: Contrast +60 (60 % of 100) becomes Exposure +3.00 (60 % of 5 EV). |
| **At the dot** | The value at the tool's dot. It can be negative (take away) or positive (add), up to the slider's full range either way. Double-click resets it to 40 % of the range. "now …" next to it shows what the tool gives right now. |
| **Curve** | How fast the value grows along the line. The same on both sides of the centre. |
| **Reverse on the opposite side** | On (default): the far side gives the opposite. Off: the tool fades to 0 at the centre and does nothing on the far side. |
| **Eye (mute)** | Switches the tool off without removing it. Its dot and label turn faint. |
| **Bin (remove)** | Removes the tool. A pad always keeps at least one tool. |

### Example 4: the three curves

One tool, value at the dot +60. "Share of the way" means how far the puck
is from the centre towards the dot (or towards the opposite ring, with the
value reversed).

| Share of the way | Linear | Soft | Ease in |
|---|---|---|---|
| 25 % | +15 | +9 | +4 |
| 50 % | +30 | +30 | +15 |
| 75 % | +45 | +51 | +34 |
| 100 % (on the dot) | +60 | +60 | +60 |

- **Linear:** steady.
- **Soft:** gentle near the centre and near the edge, quickest in the
  middle. Good for small, careful changes around the centre.
- **Ease in:** very gentle at first, strong near the edge.

### Example 5: Reverse off

Whites at the top, value −80, Linear, Reverse **off**.

| Where the puck is | Whites added |
|---|---|
| On the dot | −80 |
| Halfway up | −40 |
| Centre | 0 |
| Halfway down | 0 (no reverse) |
| Bottom edge | 0 (no reverse) |

With Reverse on, the last two rows would be +40 and +80.

## Amount and the on/off switch

- **Amount** (0–100) scales every tool at once. At 50, everything the pad
  gives is halved: +60 becomes +30.
- **Blend Pad on/off** switches the whole pad off. The photo then looks as
  the sliders alone set it. The pad keeps all its settings.

## How the pad and the sliders work together

The pad **adds to the sliders**. It never moves a slider itself.

- **They add up.** Contrast slider +20, pad +40: the photo uses +60.
- **They can cancel.** Exposure slider +1.00, pad −1.00: the photo uses 0.
- **The total stays inside the slider's range.** Contrast slider +50, pad
  +70: the photo uses +100 (the slider's maximum), not +120. Past that
  point, moving the puck further changes nothing for that tool.
- **Tools from 0 to 100 stop at 0.** Glow, Light Flare, Grain and Gaussian
  Blur cannot go below 0, but the pad can still lower them. See Example 6.
- **Hue wraps around** instead of stopping: Hue slider +170 with pad +30
  gives −160 (the same colour turn).
- **Two tools on the same slider add up.** Contrast +40 at the top and
  Contrast −30 at the bottom, puck at the top: +40 from the first tool,
  plus +30 from the second (its reverse), so +70 in total.
- **Every value is rounded to the slider's step**: whole numbers for most
  tools, two decimals for Exposure and Brightness.

### Example 6: a 0–100 tool

Glow slider at 50; a Glow tool with +40 at its dot.

| Where the puck is | Glow the photo uses |
|---|---|
| On the dot | 90 |
| Centre | 50 |
| Opposite ring | 10 |
| Opposite ring, Glow slider at 30 instead | 0 (cannot go below 0) |

### Seeing the combined value on the sliders

- A slider the pad is moving shows the photo's real value **in brackets
  before its own value**, in the accent colour, e.g. "**[60]** 20". Hover
  the bracket: "With the Blend Pad".
- The slider's track shows a small accent **tick** at the same place.
- With the puck at the centre (or the pad off), neither appears.

### Bake into sliders

The stamp button in the pad's header **writes the pad's values into the
sliders** and puts the puck back in the centre. The photo looks exactly
the same afterwards, but the values now live in the normal sliders.
Example: Contrast slider +20, pad +40. After Bake: Contrast slider +60,
pad adds 0. Bake is one undo step.

## Moving the puck and the tools

| You do | What happens |
|---|---|
| Press on the puck and drag | Every tool updates live. Only a press on the puck moves it; a press on empty space does nothing. |
| Hold **Shift** while dragging | The puck moves 4× slower, for fine changes. |
| Click the pad, then press the **arrow keys** | The puck moves a small step (Shift: a smaller one). |
| **Double-click** the puck, or click the **crosshair** in the header | The puck returns to the centre. |
| Press on a tool's **dot** and drag | The tool moves along the edge, round corners too. |
| Click a tool's dot or its card | The tool is selected: its dot gets a ring, its card a border, and its line is drawn dashed from the dot to its opposite ring, with the value at the far end (its reverse, or 0 when Reverse is off). |

A whole drag is **one undo step**, like dragging a slider.

## Adding and arranging tools

- **Add tool** (below the cards): pick a slider. The new tool goes into the
  **largest free space** on the edge, with **40 % of the slider's range**
  at its dot (Contrast +40, Exposure +2.00, Hue +72).
- A pad holds **up to 8 tools**. At 8, Add tool is greyed out.
- Tools can sit anywhere on the edge; nothing stops two tools from being
  close together.

### The 21 tools the pad can drive

Exposure, Brightness, Contrast, Highlights, Shadows, Whites, Blacks,
Temperature, Tint, Vibrance, Saturation, Hue, Clarity, Dehaze, Structure,
Centré, Vignette Amount, Gaussian Blur, Glow, Light Flare, Grain.

If you hide a section with its eye in Adjustments (for example Basic), the
pad's tools for that section do nothing either, just like the sliders.

## Shapes

Pick a shape under "Shape". Each tool keeps its place along the edge (the
same share of the way round), so a layout survives a shape change. The puck
is pulled inside the new outline if needed.

On every shape, each tool still gives its **full value at its dot** and its
**full reverse at its opposite ring**, even when the two are at different
distances from the centre. Each side of the centre is measured on its own.

### Example 7: a triangle

Contrast sits on the triangle's top corner with +60 at the dot. The top
corner is twice as far from the centre as the bottom edge.

| Where the puck is | Contrast added |
|---|---|
| Top corner | +60 |
| Halfway up to the corner | +30 |
| Centre | 0 |
| Halfway down to the bottom edge | −30 |
| On the bottom edge (opposite ring) | −60 |

The same distance from the centre gives more on the short side: just a
little below the centre already gives a strong reverse.

Shape details: all shapes fit inside the same circle, so the square looks
a little smaller than the circle. The triangle, pentagon and hexagon have
a corner at the top; the square and the rectangle sit flat. The rectangle
is 3:2, landscape. A puck dragged outside is pulled back towards the
centre until it is on the edge.

## Pad presets

The bar at the top of the pad saves pad setups under a name. Pad presets
hold **only the pad**: shape, tools and their settings, Amount, on/off
and, optionally, the puck. Regular presets (the Presets panel) are
separate and still include the pad as part of a whole look.

- **Save** (disk button): name the preset. **Include the puck position**:
  - **On:** loading the preset gives exactly this look, puck included.
  - **Off:** it loads the tools only, with the puck at the centre, ready
    to explore.
- **Load:** pick a preset from the list. It replaces the photo's pad (one
  undo step).
- **Changed since loading:** the list shows a red "*" and the Save button
  becomes **Update**, which overwrites the preset. A preset without the
  puck ignores where the puck is.
- **"…" menu:** Save as new preset, Rename, Delete (asks first), Export
  preset, Export all presets, Import presets.
- **Names** must be unique (capitals and outer spaces ignored).
- Pad presets are stored with ThisIsRAW's settings and survive restarts.

### Import and export

Exported files are JSON. Importing **checks everything** before keeping
it:

- A tool the pad does not know is dropped.
- Values out of range are pulled into range; a broken value falls back to
  a safe default.
- More than 8 tools: the extra ones are dropped.
- A preset with no usable tool, no name, or from a newer pad version is
  skipped.
- A name you already have gets a number: "Moody" becomes "Moody 2".
- A file with nothing usable shows a message and adds nothing.

## Saving, sharing and exporting

- The pad is saved **with the edit** (in the sidecar) and travels with
  **XMP sync**, so another ThisIsRAW installation sees the same pad.
- **Copy and paste settings** have their own "Blend Pad" group.
- **Exports, thumbnails and batch processing** apply the pad exactly like
  the preview.
- A photo whose pad changes its look counts as **edited**. A pad with the
  puck at the centre does not.
- The pad works on the **whole photo**. A pad per mask is planned.
- The same pad, puck position and sliders always give exactly the same
  result, whatever path the drag took.

## Quick answers

**The photo goes the "wrong" way.** The puck is on the tool's far side,
where it gives the reverse. Check the label ("now …"), or switch Reverse
off for that tool.

**A tool seems to do nothing.** The puck may be at the centre or on the
line's middle, the tool may be muted, the pad may be off, Amount may be 0,
the slider may already be at its limit, or the tool's section may be
hidden in Adjustments.

**I want to keep the result and stop using the pad.** Use Bake.

**I want the same setup on other photos.** Save a pad preset, or copy and
paste with "Blend Pad" ticked.
