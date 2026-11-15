# Zone Color Grading: How It Works

This guide explains everything Zone Color Grading does, in plain words
with worked examples. It describes ThisIsRAW `1.59.0`. The tool has its
own panel in Develop's right toolbar (the **Blend** icon, below the
Orbit Blend Pad). Inside the code and in saved edits it is still called
Zone Tint (`zoneTint`).

## The idea in one paragraph

Ansel Adams' Zone System splits the tones of a photo into eleven zones,
from Zone 0 (pure black) to Zone X (pure white), with Zone V as middle
grey. Zone Color Grading lets you give zones a colour and a brightness
shift. On a Black & White photo that tones it, like a darkroom toner:
cool shadows, warm highlights, a selenium or sepia look. On a colour
photo it grades by tone: it pushes the colours already in the shadows,
midtones or highlights towards the colour you pick. You choose zones, by
clicking the scale, by clicking the photo or by drawing a rectangle on
it, then move the colour wheel. Each coloured selection becomes a
**grade**. Grades can share zones; where they do, they add up.

## The parts of the panel

| Part | What it is |
|---|---|
| **Header buttons** | Pipette (pick a zone on the photo), rectangle (pick zones in an area of the photo), eye (switch the whole tool off and on), reset (remove everything). |
| **Zone scale** | The eleven zones as an upright grey ramp, X at the top, 0 at the bottom. The names are on the left; an accent bar marks the selected zones, and an outline the zone under the cursor on the photo. |
| **Hover readout** | Beside the cursor on the photo: the zone under it and its lightness, e.g. "Zone VI · L 0.62". |
| **Alt/Option preview** | Hold Alt (Option on macOS) over a zone or a grade: the photo shows in red where it colours. |
| **Colour bands** | On the scale's right edge, each grade's colour in the zones it covers. Where two or more grades share a zone, their colours sit side by side and a small layers icon appears (shown grades only). A hidden grade's band is faded. |
| **Colour wheel** | Hue (angle), strength (distance from the centre) and Luminance (slider under the wheel) for the selection. Its title names the selected zones, e.g. "Zones II–IV". |
| **Fill between** | A curve (Linear, Soft, Ease in) and a button that fills the zones between the first and last selected zone with a smooth ramp. |
| **Amount** | Scales the whole tool, 0–200 %. |
| **Softness** | How far each zone's colour reaches into its neighbours. |
| **Protect** | How strongly pure black and pure white are kept free of colour. |
| **Smoothing** | Picks each pixel's zone from its surroundings, so grain does not speckle the colour. |
| **Grades list** | Every grade, lightest first, with its zones, its hue (H), strength (S) and luminance (L), or "Gradient" for a ramp. An "Overlaps …" line names the zones it shares with other shown grades. Click a grade to edit it; the eye hides or shows it; × removes it. |

## Zones: which tones belong where

The zones are measured on perceptual lightness (OKLab L, 0 = black,
1 = white), not on the sRGB value a histogram shows. Zone *n* sits at
L = *n* / 10.

| Zone | Lightness | Roughly |
|---|---|---|
| 0 | 0.0 | Pure black |
| I–II | 0.1–0.2 | Deep shadows, near black with a little texture |
| III | 0.3 | Dark shadows with full detail |
| IV | 0.4 | Dark midtones, shade, dark foliage |
| V | 0.5 | Middle grey (an sRGB value of about 99 of 255) |
| VI | 0.6 | Light midtones, average skin |
| VII | 0.7 | Light tones with texture, bright skin |
| VIII | 0.8 | Highlights with a little texture |
| IX | 0.9 | Near white |
| X | 1.0 | Pure white |

The zones are read from the tones you see at that point, after
exposure, the tone curves, the LUT, Black & White and the vignette,
just before grain. Darkening an area (with a curve, a mask or the
vignette) therefore moves it into darker zones, and it takes their
colour, the way a toner acts on a burnt-in corner of a print. Grain is
added afterwards, so it stays neutral.

A pixel never belongs to just one zone. Each zone's influence fades
smoothly with distance from its centre, so a tone halfway between Zones
V and VI gets a mix of both colours. **Softness** sets how wide that
fade is.

## What a zone setting does

Each grade gives its zones three values:

- **Hue** (0–360°, the wheel's angle): which colour. 0° red, 60° yellow,
  120° green, 180° cyan, 240° blue, 300° magenta.
- **Strength** (0–100, the distance from the wheel's centre): how much
  colour. 0 is none.
- **Luminance** (−100 to +100, the slider under the wheel): brightens or
  darkens that zone's tones by up to half a zone (±0.05 L).

The colour **never changes a tone**: a pixel keeps exactly its
lightness, only its colour moves. Only Luminance changes brightness. A
colour that would fall outside what the screen can show is reduced
along the same hue instead of clipped, so it never turns into a
different colour or loses lightness.

### Example 1: toning a Black & White photo

A Black & White portrait. Click Zone VII on the scale, drag the wheel
towards orange (hue 30°) to strength 40. The light skin tones and the
bright background turn warm; the shadows stay neutral grey, and the
photo is exactly as bright as before (switch the eye off and on to
compare).

### Example 2: grading a colour photo

A landscape with a blue sky (around Zone VIII) and dark green trees
(around Zone III). Select Zone III, pick blue (240°) strength 30: the
dark greens turn teal and the shadows cooler. The sky is untouched. On
a colour photo the zone's colour adds to the colours already there, so
an orange area in a zone tinted orange gets more orange, and a blue sky
in a zone tinted orange moves towards neutral.

### Example 3: luminance

Select Zone 0, move Luminance to +60. The deepest blacks lift by 0.03 L
(three tenths of a zone): a faded, matte look. Protect does not hold
luminance back, so even pure black lifts. Neighbouring zones always
keep their order: Zone V at +100 next to Zone VI at −100 never makes a
Zone V tone brighter than a Zone VI tone.

## Selecting zones

The zones you select are what the wheel edits next.

**On the scale:**

- **Click** a zone: only that zone is selected.
- **Shift-click**: every zone from the last clicked one to this one.
- **Cmd-click** (macOS) or **Ctrl-click**: adds the zone, or removes it
  if it is already selected. The last selected zone cannot be removed.

**On the photo, with the pipette** (first header button):

- **Click** the photo: the zone of the tones under the cursor is
  selected. It samples a small square (16 screen pixels) and takes the
  zone of its average lightness.
- **Shift-click** and **Cmd/Ctrl-click** work as on the scale.

**On the photo, with the rectangle** (second header button):

- **Drag** a rectangle over an area, for example a sky or a face. On
  release, every zone that fills at least 3 % of the rectangle is
  selected. Zones with only a few stray pixels (a reflection, noise) are
  left out. The zone that fills most of the rectangle becomes the
  starting point for a following Shift-click.
- **Shift-drag** or **Cmd/Ctrl-drag** adds those zones to the current
  selection.
- A click, or a drag smaller than 4 screen pixels, picks one zone as the
  pipette does.

Both pickers read the tones **before** the grading, so on a photo that
is already graded (including luminance shifts) they pick the same zones
as before. They stay on until you click their button again, press
Escape, or open another panel. While one is on, the photo does not pan
or zoom on click.

### Example 4: picking a sky

Rectangle on, drag over the sky of a landscape. The sky runs from Zone
VII near the horizon to Zone IX at the top, so VII, VIII and IX are
selected; a few dark birds in the rectangle (Zone II, under 3 % of it)
are not. The wheel's title reads "Zones VII–IX".

### Seeing a zone before you pick it

While the panel is open, move the cursor over the photo: a small label
beside the cursor names the zone of the tones under it and their
lightness, for example **"Zone VI · L 0.62"**, and that zone is outlined
on the scale. Nothing is selected or changed.

- **L** is the lightness the zones are measured in, from 0 (black) to 1
  (white). Zone n sits at L = n / 10, so 0.62 is Zone VI, a little
  towards VII.
- The label reads the same 16-pixel square as the pipette and, like the
  pickers, the tones **before** the grading, so it shows exactly the
  zone a click would pick.
- It works with the pickers on or off, and hides while the cursor is off
  the photo or Speed Edit shows its own label.

### Seeing where a zone or grade applies (Alt/Option)

Hold **Alt** (**Option** on macOS) and point at a zone on the scale: the
photo shows that zone's area in red, the same overlay masks use, and
stronger where the zone gives more of its colour. Point at a row in the
**Grades** list instead to see all of that grade's zones together.
Release the key or move away and the overlay goes.

- It shows exactly how the colour is shared out: a zone is strongest at
  its own tones and fades into its neighbours as far as **Softness**
  lets it, and **Protect** keeps pure black and white free, so Zone 0
  and Zone X show little or nothing there.
- It does not depend on the zone's colour, so a zone you have not
  coloured yet previews too: a quick way to see what a selection would
  touch before you move the wheel.
- Like the pickers, it reads the tones **before** the grading.
- Nothing is changed or selected.

## Grades

**A new selection is not a grade yet.** The wheel then shows neutral.
The moment you move the wheel, the selection becomes a grade with what
you set. Later wheel moves keep editing that grade until you change the
selection.

**Another selection makes another grade**, even when it shares zones
with an existing one. Each grade keeps its own settings.

**To edit a grade again**, click it in the Grades list. Its zones are
selected and the wheel shows its settings. Moving the wheel writes only
the value you moved (hue, strength or luminance) into every zone of the
grade, so moving the hue keeps the strength.

**To remove a grade**, click its ×. The header's reset removes all
grades and every other setting of the tool.

**To hide a grade**, click the eye on its row; click it again to show
it. A hidden grade keeps all its settings and is saved with the edit,
but it has no effect on the photo:

- Its row in the Grades list is dimmed and its band on the scale is
  faded.
- It does not combine with other grades, so it neither causes nor shows
  an "Overlaps …" line or a layers icon.
- Moving the wheel while a hidden grade is selected shows it again, so
  the change is visible.
- Fill between still takes its zones out of hidden grades, so the ramp
  stays exact when they are shown again, and reads its ends from what
  the shown grades give those zones.
- Hiding and showing are undo steps.

Hiding every grade leaves the photo as if the tool had no grades; the
panel's own eye switches the whole tool off instead.

### How overlapping grades combine

Where grades share a zone, their settings add up in that zone:

- **Colours add as points on the colour wheel.** Picture each colour as
  an arrow from the wheel's centre: its direction is the hue, its length
  the strength. The arrows are placed end to end. Similar hues therefore
  strengthen each other, and opposite hues cancel towards neutral
  instead of turning into the colour between them.
- **Luminance shifts add.**
- The sum stops at strength 100 and at luminance ±100.

| Zone IV gets | Result in Zone IV |
|---|---|
| Hue 30° strength 40, plus hue 30° strength 30 | Hue 30°, strength 70 (same colour, stronger) |
| Hue 20° strength 40, plus hue 60° strength 40 | Hue 40°, strength 75 (in between, a little less than 80) |
| Hue 220° strength 40, plus hue 40° strength 30 | Hue 220°, strength 10 (opposites: mostly cancelled, the stronger one wins) |
| Hue 30° strength 80, plus hue 30° strength 60 | Hue 30°, strength 100 (capped) |
| Luminance +30, plus luminance +20 | Luminance +50 |

The scale's grey shows the summed luminance; its bands show each
grade's own colour side by side, with a layers icon on shared zones, and
hovering such a zone says how many grades overlap there.

### Example 5: a split tone with an overlap

1. Click Zone II, Shift-click Zone IV, drag the wheel to blue (220°)
   strength 40. The list shows one grade, "Zones II–IV, H 220° S 40".
2. Click Zone IV, Shift-click Zone VI, drag to amber (40°) strength 30.
   A second grade appears, "Zones IV–VI, H 40° S 30".
3. Zone IV now belongs to both. On the scale it shows a blue and an
   amber band side by side with the layers icon; in the list both grades
   show "Overlaps IV". In the photo, Zone IV's tones are a faint blue
   (strength 10): the two colours mostly cancel, so the shadows' blue
   fades out before the amber starts.
4. Click the amber grade in the list and drag its strength to 40: Zone
   IV becomes neutral (equal opposite colours cancel), V and VI get
   stronger amber, the blue grade is unchanged.

## Fill between (ramps)

Fill between draws a smooth ramp across the zones between two ends.
Select an unbroken range of at least three zones (e.g. II to VII), pick
a curve, click **Fill between**. The ends are the first and last
selected zone; their colours are what they show now (the sum of their
grades). The zones strictly between them become **one gradient grade**
that blends from one end to the other, in colour and luminance.

- Colours blend as arrows on the wheel, like overlaps: opposite ends
  meet in a soft neutral in the middle instead of sweeping through the
  hues between them (blue to amber does not pass through green).
- An untinted end fades the other end's colour out.
- **The ramp replaces** other grades on the zones between: they are
  taken out of those grades, and a grade left with no zones disappears.
  The ends keep their grades. One undo step reverts it.
- The curve sets where the change happens: **Linear** evenly, **Soft**
  slowly at both ends and faster in the middle, **Ease in** slowly at
  first.
- The button is disabled for one or two zones and for a Cmd/Ctrl
  selection with gaps.

### Example 6: a blue-to-amber ramp

Zone II is blue (220°) strength 50, Zone VII is amber (40°) strength 50,
from two grades. Select II to VII, Linear, Fill between:

| Zone | Result |
|---|---|
| II | Blue 220° strength 50 (its own grade, unchanged) |
| III | Blue 220° strength 30 |
| IV | Blue 220° strength 10 |
| V | Amber 40° strength 10 |
| VI | Amber 40° strength 30 |
| VII | Amber 40° strength 50 (its own grade, unchanged) |

The list gains a grade "Zones III–VI, Gradient". If Zones IV–V had
belonged to another grade before, they were taken out of it first.

**Editing a ramp later:** clicking the gradient grade and moving the
wheel writes the moved value into every zone of it, so moving its hue
gives all its zones that hue (their strengths stay). To change the ramp
itself, change an end and run Fill between again.

## Amount, Softness, Protect, Smoothing

These apply to the whole tool, all grades together.

- **Amount** (0–200 %, default 100 %) multiplies every zone's strength
  and luminance when rendered, without changing the stored values. At
  200 % a weak zone doubles, but nothing goes beyond strength 100.
  Amount 0 shows the photo without the tool.
- **Softness** (2–8, default 4) is how far a zone's colour reaches: at
  2, Zone V's colour stays close to Zone V's tones; at 8 it spreads well
  into IV and VI and neighbouring colours blend more. Luminance never
  spreads narrower than the default, so tones keep their order.
- **Protect** (0–20, default 8) fades the colour out towards pure black
  and pure white, so Zone 0 stays black and Zone X stays paper white
  even with Zones 0 and X coloured. At 0 a coloured paper white is
  possible. Protect never limits luminance.
- **Smoothing** (0–4, default 0) stops grain from picking the zones. On a
  grainy photo neighbouring pixels of one surface jump between zones,
  so each takes a different colour and the colour looks speckled.
  Smoothing picks each pixel's zone from the tones of its surroundings
  instead (at 1 a fine area, at 3.5 and above a wider one, scaled with
  the image size so the export matches the preview). It changes only
  where the colour goes: the brightness, the luminance shifts and
  Protect still follow each pixel's own tone, and nothing is blurred.
  The surroundings are judged from the photo before editing, so where
  strong curves or masks change neighbouring tones very differently the
  colour follows the original tones a little more. The pickers and the
  hover readout still read each pixel's own tone; the Alt/Option preview
  shows the smoothed result.

### Example 7: Protect

Colour Zone X with a warm hue 30° strength 60. With Protect at 8 the
brightest highlights stay neutral white and the warmth starts in the
light greys below them. Set Protect to 0: the paper white itself turns
cream.

## Switching off, resetting, saving

- The header's **eye** switches the whole tool off and on (before and
  after). The Color section's eye does not affect it.
- The header's **reset** removes all grades and every setting. The
  Adjustments panel's own reset leaves this tool alone.
- Switching Black & White off keeps the grading; it then grades the
  colour photo.
- The grading saves with the edit and travels with it: XMP sidecars,
  copy and paste (its own group, "Zone Color Grading"), presets, export
  and other ThisIsRAW installations.
- Masks in a blend mode other than Normal keep the grading in the
  backdrop they blend against. The tool is not available inside masks
  yet.

## Edits made with earlier versions

Edits from before grades (`1.57.x`, `1.58.0`) open unchanged. Each run
of neighbouring zones with the same settings becomes one grade. A ramp
made with Fill between in those versions has a different value in every
zone, so it opens as one single-zone grade per zone; it looks the same,
but the list is longer. Remove them and run Fill between again to get a
single gradient grade.

Builds before `1.59.0` that open an edit made with grades render it the
same (they read the summed zones), but they cannot edit the grades
themselves. If such a build changes the grading, `1.59.0` notices that
the grades no longer add up to what is saved, keeps the older build's
result, and shows it as grades made from its zones (as for any older
edit); the earlier grades are not restored.
