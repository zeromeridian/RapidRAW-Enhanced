# TIR — Zone Tint: Zone System colorization plan


## Goal and scope

Add **Zone Tint** to TIR. It lets the user give any of the 11 Zone System zones (0–X) its own color on a B&W image, without changing the image's tones. It replaces the role LRC's 3-way color grading plays, with finer and more photographic control.

In scope:

- A global Zone Tint panel with 11 fixed zones, soft blending between them
- Luminance-preserving color (tones from the B&W mix and curve stay exactly as set)
- Optional advanced mode: move a zone's center or change its width
- Presets, and saving with the edit

Later phase: Zone Tint inside local masks (brush, gradient, AI masks).

Out of scope: color images. Zone Tint only appears when the image is in B&W mode.

## Zone model

The 11 zones sit evenly on perceptual lightness (OKLab L, 0–1), with each zone's center cₙ = n / 10. Zone V lands near L* 50 (middle grey). Each zone is one stop apart, so even spacing on a perceptual scale matches what photographers expect.

|   |   |   |
|---|---|---|
|Zone|Center (L)|Typical content|
|0|0.0|Pure black, no texture|
|I–II|0.1–0.2|Near black, first hints of texture|
|III|0.3|Dark detailed shadows|
|IV–VI|0.4–0.6|Midtones, skin, foliage, middle grey at V|
|VII|0.7|Light tones with full texture|
|VIII–IX|0.8–0.9|Bright highlights, texture fading|
|X|1.0|Paper white|

Zones overlap instead of being hard bands, so smooth gradients like skies never show steps. Each zone gets a Gaussian weight, and the weights are normalized so they always sum to 1:

```latex
w_n(L) = \frac{e^{-(L - c_n)^2 / 2\sigma^2}}{\sum_{k=0}^{10} e^{-(L - c_k)^2 / 2\sigma^2}}
```

With σ = 0.04 (the default **Zone softness**), a tint on Zone VII has about 92% strength at VII's center, 50% halfway to VI or VIII, and about 4% at their centers. Untinted zones count as neutral. If every zone gets the same color, the result is uniform, which is a useful sanity check.

Advanced mode lets the user offset a zone's center by up to ±0.05 and set its own σ. The 11 standard positions remain the snap points, and double-clicking a zone resets it.

## Color math

Tinting happens in OKLab, and L is never changed. The B&W pixel has a = b = 0, so the tint is just a chroma vector added at the same lightness:

```latex
(a, b) = p(L) \cdot \sum_{n=0}^{10} w_n(L) \cdot C_n \cdot (\cos h_n, \sin h_n)
```

Here hₙ is the zone's hue and Cₙ its chroma. The UI's 0–100 strength maps to Cₙ = 0–0.10, which already gives a strong tint. Summing vectors (instead of hues) means two neighbouring zones with different colors blend smoothly through their mix, never through a hue jump.

**Black and white protection p(L).** Colored Zone 0 and Zone X usually look like an error, so chroma fades out at both ends:

```latex
p(L) = \mathrm{smoothstep}(0, t, L) \cdot (1 - \mathrm{smoothstep}(1 - t, 1, L))
```

The user's **Protect** slider sets t (0.0–0.2, default 0.08). At 0, a deliberately colored paper white is possible.

**Gamut.** At high chroma near the ends, OKLab → RGB can go out of gamut. Reduce chroma along the same hue until the result fits (no hard clipping), so lightness stays exact.

**Mask smoothing.** The L used for the weights (not the image itself) gets an optional small blur, 0–4 px at preview scale, with a default of 1. This keeps grain and sensor noise from showing up as color speckle in the tinted zones.

## Pipeline placement

Zone Tint runs after every tonal step and before the output transform, so the zones match the tones the user actually sees.

1. Exposure, white balance and other pre-B&W adjustments
2. B&W conversion (channel mix)
3. Tone curve, contrast, shadows and highlights, local tonal masks
4. Vignette
5. **Zone Tint** (reads L here, writes a and b)
6. Grain
7. Output transform and display or export encoding

Why this order: if the masks read L before the curve, moving the curve quietly moves the color zones. Grain comes after the tint so that grain stays neutral instead of picking up zone colors.

Implementation notes for RapidRAW-Enhanced:

- Add the tint as a function in the main shader at step 5. The exact file and stage still need to be confirmed against the current shader chain.
- Mask smoothing needs the neighbouring pixels, so it either becomes a small separate blur pass on a single L texture or is skipped in the first version (Phase 1 runs without it).
- Zone parameters go to the GPU as one uniform block: 11 × (a, b) precomputed on the CPU, plus σ, t and the center offsets. No per-pixel trigonometry.

## UI

The panel is a strip of 11 zone swatches, 0 to X, placed directly under the histogram so zones and histogram line up.

- **Swatch** shows the zone's grey value, with its tint color as a small dot or inner ring. Untinted zones show just the grey.
- **Click a zone** to select it. Below the strip, a hue wheel or slider and a **Strength** slider (0–100) edit the selected zone. Shift-click selects several zones and edits them together.
- **Hover the image** to highlight the zone under the cursor on the strip and show a readout such as “Zone VI · L 0.62”.
- **Hold Alt (Option on macOS) over a swatch** to overlay that zone's weight on the image as a mask preview, so the user sees exactly what will be colored.
- **Global controls:** Zone softness (σ), Protect (t), Mask smoothing, and an Advanced toggle.
- **Advanced mode** shows small handles above the swatches for dragging a zone's center, plus a per-zone width. Double-click resets a zone.
- **Reset** clears all tints. The panel header has an on/off toggle for quick before and after.

The hover readout reads from the CPU-side preview buffer at the same pipeline stage (after the curve, before the tint), so the zone it reports matches the shader.

## Data model, presets and Curve Stamp

Zone Tint is stored as one block in the edit's adjustments, next to the existing settings, so it saves, copies, pastes and syncs like any other adjustment.

|   |   |   |   |
|---|---|---|---|
|Field|Type|Range|Default|
|enabled|bool|on/off|on|
|zones[0..10].hue|float|0–360°|0|
|zones[0..10].strength|float|0–100|0 (neutral)|
|zones[0..10].centerOffset|float|−0.05 to +0.05|0|
|zones[0..10].width|float or null|0.02–0.08|null (uses softness)|
|softness|float|0.02–0.08|0.04|
|protect|float|0–0.20|0.08|
|maskSmoothing|float|0–4 px|1|
|version|int||1|

A missing block means “off”, so older edits load unchanged. The version field leaves room for later changes to the math.

**Presets.** A Zone Tint preset saves only this block, so it can be applied over any B&W conversion. Suggested starter set: Selenium (cool purple-brown in III–V), Sepia (warm VI–VIII), Split (cool II–IV, warm VII–VIII) and Platinum (gentle warm across all zones).

**Curve Stamp.** For ColrBent, the stamp can show the tone curve as usual with an 11-swatch zone strip along its bottom edge. A named look such as Afterglow then means “this curve plus this zone tint”. Export the stamp from the same data, so it always matches the edit.

## Implementation phases

There are four phases, each shippable on its own. Each phase must pass its exit check before the next one starts.

1. **Core math and shader.** OKLab conversion helpers, zone weights, the tint function at pipeline step 5, Protect and gamut handling. Parameters come from a hard-coded test config, with no UI yet.
    - Exit check: a grey ramp with one tinted zone shows the expected bump, and L is unchanged to within 0.001.
2. **Basic panel.** The 11-swatch strip, zone selection, hue and strength, softness and Protect, on/off, reset. The adjustments block is saved with the edit and loads correctly in older edits.
    - Exit check: tint, save, reopen and export all match the preview.
3. **Feedback tools and presets.** Hover readout, Alt mask preview, mask smoothing (separate blur pass), multi-select, and the four starter presets.
    - Exit check: on a grainy high-ISO file, smoothing at 1–2 px removes the color speckle.
4. **Advanced mode and local masks.** Movable centers and per-zone width. Zone Tint as an adjustment inside existing local masks, where the mask weight multiplies the zone weight.
    - Exit check: a sky gradient mask with a Zone VIII tint colors only the sky highlights.

The Curve Stamp export can follow any time after Phase 2, since it only reads the saved data.

## Testing and acceptance

Zone Tint is done when every check below passes on both preview and export.

- **Tone preservation:** the OKLab L of the tinted output matches the untinted output to within 0.001, across a 0–1 grey ramp at full strength in every zone.
- **No banding:** a smooth 16-bit sky gradient with two neighbouring zones tinted in contrasting hues shows no visible steps.
- **Uniform check:** all 11 zones set to the same hue and strength give a uniform tint, except where Protect fades it at the ends.
- **Clean ends:** with Protect at its default, Zone 0 and Zone X pixels stay neutral (chroma below 0.002).
- **Gamut:** strength 100 on Zones I and IX produces no clipped channels or hue shifts.
- **Noise:** on an ISO 6400+ file, smoothing at 1 px shows no color speckle at 100% zoom.
- **Round trip:** save, close, reopen, copy and paste to another image, and export all reproduce the preview.
- **Old edits:** edits made before Zone Tint open unchanged.
- **Performance:** preview frame time increases by less than 5% with Zone Tint on (smoothing pass included).

## Open questions

- Should vignette sit before Zone Tint (zones follow the vignetted tones) or after it (vignette darkens the tint)? The plan currently says before.
- Does TIR's B&W mode already have a single place in the shader where L is available after the curve, or does that need adding?
- Should Zone Tint also be offered on color images, as a zone-based color grade? Out of scope for now.
- Hue control: a full wheel per zone, or a hue slider with a small swatch? The wheel is clearer, the slider is more compact.
- Should LRC-style 3-way grading be importable, mapped onto Zones II, V and VIII?
- Is the Zone Tint panel also wanted in monoRAW later, or is it TIR only?