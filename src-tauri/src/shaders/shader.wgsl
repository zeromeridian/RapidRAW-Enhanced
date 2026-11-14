struct Point {
    x: f32,
    y: f32,
    _pad1: f32,
    _pad2: f32,
}

struct HslColor {
    hue: f32,
    saturation: f32,
    luminance: f32,
    _pad: f32,
}

// One Point Color (`image_processing::PointColorSettings`). Ranges are min, max, min fade
// and max fade relative to the target, hue in degrees.
struct PointColor {
    hue: f32,
    saturation: f32,
    luminance: f32,
    hue_shift: f32,
    saturation_shift: f32,
    luminance_shift: f32,
    _pad1: f32,
    _pad2: f32,
    hue_range: vec4<f32>,
    saturation_range: vec4<f32>,
    luminance_range: vec4<f32>,
}

// Zone Tint (`zone_tint::ZoneTintSettings`). Per zone: OKLab a and b at full weight, the
// centre in OKLab L and 1 / (2σ²); then each zone's shift in L, four zones to a vector.
struct ZoneTint {
    zones: array<vec4<f32>, 11>,
    enabled: u32,
    protect: f32,
    luminance_weight_cap: f32,
    has_luminance: u32,
    luminance: array<vec4<f32>, 3>,
}

struct ColorGradeSettings {
    hue: f32,
    saturation: f32,
    luminance: f32,
    _pad: f32,
}

struct ColorCalibrationSettings {
    shadows_tint: f32,
    red_hue: f32,
    red_saturation: f32,
    green_hue: f32,
    green_saturation: f32,
    blue_hue: f32,
    blue_saturation: f32,
    _pad1: f32,
}

struct GlobalAdjustments {
    exposure: f32,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,
    hue: f32,
    monochrome: u32,
    _pad_color2: f32,
    _pad_color3: f32,

    sharpness: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,
    centre: f32,
    vignette_amount: f32,
    vignette_midpoint: f32,
    vignette_roundness: f32,
    vignette_feather: f32,
    grain_amount: f32,
    grain_size: f32,
    grain_roughness: f32,

    chromatic_aberration_red_cyan: f32,
    chromatic_aberration_blue_yellow: f32,
    show_clipping: u32,
    is_raw_image: u32,
    halation_hue_shift: f32,

    has_lut: u32,
    lut_intensity: f32,
    tonemapper_mode: u32,
    natural_exposure_ev: f32,
    _pad_lut3: f32,
    _pad_lut4: f32,
    _pad_lut5: f32,

    _pad_agx1: f32,
    _pad_agx2: f32,
    _pad_agx3: f32,
    agx_pipe_to_rendering_matrix: mat3x3<f32>,
    agx_rendering_to_pipe_matrix: mat3x3<f32>,

    _pad_cg1: f32,
    _pad_cg2: f32,
    _pad_cg3: f32,
    _pad_cg4: f32,
    color_grading_shadows: ColorGradeSettings,
    color_grading_midtones: ColorGradeSettings,
    color_grading_highlights: ColorGradeSettings,
    color_grading_global: ColorGradeSettings,
    color_grading_blending: f32,
    color_grading_balance: f32,
    _pad2: f32,
    _pad3: f32,

    color_calibration: ColorCalibrationSettings,

    hsl: array<HslColor, 8>,
    luma_curve: array<Point, 16>,
    red_curve: array<Point, 16>,
    green_curve: array<Point, 16>,
    blue_curve: array<Point, 16>,
    luma_curve_count: u32,
    red_curve_count: u32,
    green_curve_count: u32,
    blue_curve_count: u32,
    _pad_end1: f32,
    _pad_end2: f32,
    _pad_end3: f32,
    _pad_end4: f32,

    glow_amount: f32,
    halation_amount: f32,
    flare_amount: f32,
    sharpness_threshold: f32,

    gaussian_blur_amount: f32,
    _pad_motion_blur2: f32,
    glow_hue: f32,
    glow_saturation: f32,

    point_colors: array<PointColor, 8>,
    point_color_count: u32,
    point_color_visualize: u32,
    _pad_point_color1: f32,
    _pad_point_color2: f32,

    zone_tint: ZoneTint,
}

struct MaskAdjustments {
    exposure: f32,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,
    monochrome: u32,
    blend_mode: u32,
    _pad_color2: f32,
    _pad_color3: f32,

    sharpness: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,

    glow_amount: f32,
    halation_amount: f32,
    flare_amount: f32,
    sharpness_threshold: f32,
    vignette_amount: f32,
    vignette_midpoint: f32,
    vignette_roundness: f32,
    vignette_feather: f32,
    grain_amount: f32,
    grain_size: f32,
    grain_roughness: f32,
    gaussian_blur_amount: f32,
    glow_hue: f32,
    glow_saturation: f32,

    hue: f32,
    color_grading_shadows: ColorGradeSettings,
    color_grading_midtones: ColorGradeSettings,
    color_grading_highlights: ColorGradeSettings,
    color_grading_global: ColorGradeSettings,
    color_grading_blending: f32,
    color_grading_balance: f32,
    _pad5: f32,
    _pad6: f32,

    color_calibration: ColorCalibrationSettings,

    hsl: array<HslColor, 8>,
    luma_curve: array<Point, 16>,
    red_curve: array<Point, 16>,
    green_curve: array<Point, 16>,
    blue_curve: array<Point, 16>,
    luma_curve_count: u32,
    red_curve_count: u32,
    green_curve_count: u32,
    blue_curve_count: u32,
    halation_hue_shift: f32,
    _pad_end5: f32,
    _pad_end6: f32,
    _pad_end7: f32,
}

struct AllAdjustments {
    global: GlobalAdjustments,
    mask_adjustments: array<MaskAdjustments, 32>,
    mask_count: u32,
    tile_offset_x: u32,
    tile_offset_y: u32,
    mask_atlas_cols: u32,
}

struct HslRange {
    center: f32,
    width: f32,
}

const HSL_RANGES: array<HslRange, 8> = array<HslRange, 8>(
    HslRange(358.0, 35.0),  // Red
    HslRange(25.0, 45.0),   // Orange
    HslRange(60.0, 40.0),   // Yellow
    HslRange(115.0, 90.0),  // Green
    HslRange(180.0, 60.0),  // Aqua
    HslRange(225.0, 60.0),  // Blue
    HslRange(280.0, 55.0),  // Purple
    HslRange(330.0, 50.0)   // Magenta
);

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> adjustments: AllAdjustments;

@group(0) @binding(3) var mask_textures: texture_2d_array<f32>;

@group(0) @binding(4) var lut_texture: texture_3d<f32>;
@group(0) @binding(5) var lut_sampler: sampler;

@group(0) @binding(6) var sharpness_blur_texture: texture_2d<f32>;
@group(0) @binding(7) var tonal_blur_texture: texture_2d<f32>;
@group(0) @binding(8) var clarity_blur_texture: texture_2d<f32>;
@group(0) @binding(9) var structure_blur_texture: texture_2d<f32>;

@group(0) @binding(10) var flare_texture: texture_2d<f32>;
@group(0) @binding(11) var linear_sampler: sampler;

override HIGH_PRECISION_OUTPUT: u32 = 0u;
// A sample probe writes the colour a targeted adjustment reads at its stage
// instead of the finished pixel (`gpu_processing::SampleProbe`).
override SAMPLE_PROBE: u32 = 0u;
const SAMPLE_PROBE_HSL: u32 = 1u;
const SAMPLE_PROBE_CURVE: u32 = 2u;
const SAMPLE_PROBE_MASK_CURVE: u32 = 3u;
const SAMPLE_PROBE_POINT_COLOR: u32 = 4u;

const LUMA_COEFF = vec3<f32>(0.2126, 0.7152, 0.0722);

fn get_luma(c: vec3<f32>) -> f32 {
    return dot(c, LUMA_COEFF);
}

fn monochrome_srgb(c: vec3<f32>) -> vec3<f32> {
    return linear_to_srgb(vec3<f32>(get_luma(srgb_to_linear(max(c, vec3<f32>(0.0))))));
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let cutoff = vec3<f32>(0.04045);
    let a = vec3<f32>(0.055);
    let higher = pow((c + a) / (1.0 + a), vec3<f32>(2.4));
    let lower = c / 12.92;
    return select(higher, lower, c <= cutoff);
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
    let c_clamped = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let cutoff = vec3<f32>(0.0031308);
    let a = vec3<f32>(0.055);
    let higher = (1.0 + a) * pow(c_clamped, vec3<f32>(1.0 / 2.4)) - a;
    let lower = c_clamped * 12.92;
    return select(higher, lower, c_clamped <= cutoff);
}

fn linear_to_srgb_extended(c: vec3<f32>) -> vec3<f32> {
    let safe_c = max(c, vec3<f32>(0.0));
    let cutoff = vec3<f32>(0.0031308);
    let a = vec3<f32>(0.055);
    let higher = (1.0 + a) * pow(safe_c, vec3<f32>(1.0 / 2.4)) - a;
    let lower = safe_c * 12.92;
    return select(higher, lower, safe_c <= cutoff);
}

// OKLab (Björn Ottosson) from and to linear sRGB.
fn linear_srgb_to_oklab(c: vec3<f32>) -> vec3<f32> {
    let lms = vec3<f32>(
        0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
        0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
        0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b,
    );
    let root = sign(lms) * pow(abs(lms), vec3<f32>(1.0 / 3.0));
    return vec3<f32>(
        0.2104542553 * root.x + 0.7936177850 * root.y - 0.0040720468 * root.z,
        1.9779984951 * root.x - 2.4285922050 * root.y + 0.4505937099 * root.z,
        0.0259040371 * root.x + 0.7827717662 * root.y - 0.8086757660 * root.z,
    );
}

fn oklab_to_linear_srgb(lab: vec3<f32>) -> vec3<f32> {
    let root = vec3<f32>(
        lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
        lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
        lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z,
    );
    let lms = root * root * root;
    return vec3<f32>(
        4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
        -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
        -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z,
    );
}

fn in_unit_gamut(c: vec3<f32>) -> bool {
    return all(c >= vec3<f32>(0.0)) && all(c <= vec3<f32>(1.0));
}

// Zone Tint on display sRGB: adds the zones' chroma at the pixel's OKLab L, never changing L.
// Chroma that would leave sRGB is reduced along the same hue instead of clipped.
fn apply_zone_tint(srgb: vec3<f32>, tint: ZoneTint) -> vec3<f32> {
    let lab = linear_srgb_to_oklab(srgb_to_linear(clamp(srgb, vec3<f32>(0.0), vec3<f32>(1.0))));
    let l = lab.x;

    // Normalised Gaussian weights, offset by the nearest zone's exponent so a narrow zone
    // far from L cannot underflow every weight.
    var nearest = 1e30;
    for (var n = 0u; n < 11u; n = n + 1u) {
        let d = l - tint.zones[n].z;
        nearest = min(nearest, d * d * tint.zones[n].w);
    }
    var weight_sum = 0.0;
    var chroma = vec2<f32>(0.0);
    for (var n = 0u; n < 11u; n = n + 1u) {
        let zone = tint.zones[n];
        let d = l - zone.z;
        let weight = exp(nearest - d * d * zone.w);
        weight_sum += weight;
        chroma += weight * zone.xy;
    }
    var protection = 1.0;
    if (tint.protect > 0.0) {
        protection = smoothstep(0.0, tint.protect, l) * (1.0 - smoothstep(1.0 - tint.protect, 1.0, l));
    }
    chroma *= protection / weight_sum;

    // Luminance: the zones' shifts in L, weighed like the colours but never narrower than
    // the cap allows, so the tones keep their order. Protect does not hold it back.
    var new_l = l;
    if (tint.has_luminance == 1u) {
        var nearest_l = 1e30;
        for (var n = 0u; n < 11u; n = n + 1u) {
            let d = l - tint.zones[n].z;
            nearest_l = min(nearest_l, d * d * min(tint.zones[n].w, tint.luminance_weight_cap));
        }
        var luminance_weight_sum = 0.0;
        var shift = 0.0;
        for (var n = 0u; n < 11u; n = n + 1u) {
            let d = l - tint.zones[n].z;
            let weight = exp(nearest_l - d * d * min(tint.zones[n].w, tint.luminance_weight_cap));
            luminance_weight_sum += weight;
            shift += weight * tint.luminance[n / 4u][n % 4u];
        }
        new_l = clamp(l + shift / luminance_weight_sum, 0.0, 1.0);
    }
    if (all(chroma == vec2<f32>(0.0)) && new_l == l) {
        return srgb;
    }

    let full = oklab_to_linear_srgb(vec3<f32>(new_l, lab.yz + chroma));
    if (in_unit_gamut(full)) {
        return linear_to_srgb(full);
    }
    // Search the largest share of the added chroma that fits. The pixel's own chroma is in
    // gamut at its own L; at a moved L it may not be, and then it is reduced with the tint
    // (a grey at any L in 0–1 always fits).
    var kept = lab.yz;
    var added = chroma;
    if (!in_unit_gamut(oklab_to_linear_srgb(vec3<f32>(new_l, lab.yz)))) {
        kept = vec2<f32>(0.0);
        added = lab.yz + chroma;
    }
    var inside = 0.0;
    var outside = 1.0;
    for (var i = 0u; i < 12u; i = i + 1u) {
        let share = 0.5 * (inside + outside);
        if (in_unit_gamut(oklab_to_linear_srgb(vec3<f32>(new_l, kept + added * share)))) {
            inside = share;
        } else {
            outside = share;
        }
    }
    return linear_to_srgb(oklab_to_linear_srgb(vec3<f32>(new_l, kept + added * inside)));
}

fn rgb_to_hsv(c: vec3<f32>) -> vec3<f32> {
    let c_max = max(c.r, max(c.g, c.b));
    let c_min = min(c.r, min(c.g, c.b));
    let delta = c_max - c_min;
    var h: f32 = 0.0;
    if (delta > 0.0) {
        if (c_max == c.r) { h = 60.0 * (((c.g - c.b) / delta) % 6.0); }
        else if (c_max == c.g) { h = 60.0 * (((c.b - c.r) / delta) + 2.0); }
        else { h = 60.0 * (((c.r - c.g) / delta) + 4.0); }
    }
    if (h < 0.0) { h += 360.0; }
    let s = select(0.0, delta / c_max, c_max > 0.0);
    return vec3<f32>(h, s, c_max);
}

fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
    let h = c.x; let s = c.y; let v = c.z;
    let C = v * s;
    let X = C * (1.0 - abs((h / 60.0) % 2.0 - 1.0));
    let m = v - C;
    var rgb_prime: vec3<f32>;
    if (h < 60.0) { rgb_prime = vec3<f32>(C, X, 0.0); }
    else if (h < 120.0) { rgb_prime = vec3<f32>(X, C, 0.0); }
    else if (h < 180.0) { rgb_prime = vec3<f32>(0.0, C, X); }
    else if (h < 240.0) { rgb_prime = vec3<f32>(0.0, X, C); }
    else if (h < 300.0) { rgb_prime = vec3<f32>(X, 0.0, C); }
    else { rgb_prime = vec3<f32>(C, 0.0, X); }
    return rgb_prime + vec3<f32>(m, m, m);
}

fn rgb_to_hsl(c: vec3<f32>) -> vec3<f32> {
    let maximum = max(c.r, max(c.g, c.b));
    let minimum = min(c.r, min(c.g, c.b));
    let delta = maximum - minimum;
    let lightness = (maximum + minimum) * 0.5;
    var hue = 0.0;
    var saturation = 0.0;
    if (delta > 0.000001) {
        saturation = delta / max(0.000001, 1.0 - abs(2.0 * lightness - 1.0));
        if (maximum == c.r) { hue = 60.0 * (((c.g - c.b) / delta) % 6.0); }
        else if (maximum == c.g) { hue = 60.0 * (((c.b - c.r) / delta) + 2.0); }
        else { hue = 60.0 * (((c.r - c.g) / delta) + 4.0); }
        if (hue < 0.0) { hue += 360.0; }
    }
    return vec3<f32>(hue, saturation, lightness);
}

fn hsl_to_rgb(c: vec3<f32>) -> vec3<f32> {
    let chroma = (1.0 - abs(2.0 * c.z - 1.0)) * c.y;
    let x = chroma * (1.0 - abs((c.x / 60.0) % 2.0 - 1.0));
    let offset = c.z - chroma * 0.5;
    var rgb = vec3<f32>(0.0);
    if (c.x < 60.0) { rgb = vec3<f32>(chroma, x, 0.0); }
    else if (c.x < 120.0) { rgb = vec3<f32>(x, chroma, 0.0); }
    else if (c.x < 180.0) { rgb = vec3<f32>(0.0, chroma, x); }
    else if (c.x < 240.0) { rgb = vec3<f32>(0.0, x, chroma); }
    else if (c.x < 300.0) { rgb = vec3<f32>(x, 0.0, chroma); }
    else { rgb = vec3<f32>(chroma, 0.0, x); }
    return rgb + vec3<f32>(offset);
}

fn color_burn_channel(backdrop: f32, source: f32) -> f32 {
    if (source <= 0.0) { return 0.0; }
    return 1.0 - min(1.0, (1.0 - backdrop) / source);
}

fn color_dodge_channel(backdrop: f32, source: f32) -> f32 {
    if (source >= 1.0) { return 1.0; }
    return min(1.0, backdrop / (1.0 - source));
}

fn soft_light_channel(backdrop: f32, source: f32) -> f32 {
    if (source <= 0.5) {
        return backdrop - (1.0 - 2.0 * source) * backdrop * (1.0 - backdrop);
    }
    var d: f32;
    if (backdrop <= 0.25) { d = ((16.0 * backdrop - 12.0) * backdrop + 4.0) * backdrop; }
    else { d = sqrt(backdrop); }
    return backdrop + (2.0 * source - 1.0) * (d - backdrop);
}

fn vivid_light_channel(backdrop: f32, source: f32) -> f32 {
    if (source < 0.5) { return color_burn_channel(backdrop, 2.0 * source); }
    return color_dodge_channel(backdrop, 2.0 * (source - 0.5));
}

fn blend_colors(backdrop_input: vec3<f32>, source_input: vec3<f32>, mode: u32) -> vec3<f32> {
    let backdrop = clamp(backdrop_input, vec3<f32>(0.0), vec3<f32>(1.0));
    let source = clamp(source_input, vec3<f32>(0.0), vec3<f32>(1.0));
    if (mode == 1u) { return min(backdrop, source); }
    if (mode == 2u) { return backdrop * source; }
    if (mode == 3u) { return vec3<f32>(color_burn_channel(backdrop.r, source.r), color_burn_channel(backdrop.g, source.g), color_burn_channel(backdrop.b, source.b)); }
    if (mode == 4u) { return max(vec3<f32>(0.0), backdrop + source - 1.0); }
    if (mode == 5u) { return max(backdrop, source); }
    if (mode == 6u) { return backdrop + source - backdrop * source; }
    if (mode == 7u) { return vec3<f32>(color_dodge_channel(backdrop.r, source.r), color_dodge_channel(backdrop.g, source.g), color_dodge_channel(backdrop.b, source.b)); }
    if (mode == 8u) { return min(vec3<f32>(1.0), backdrop + source); }
    if (mode == 9u) {
        return vec3<f32>(select(2.0 * backdrop.r * source.r, 1.0 - 2.0 * (1.0 - backdrop.r) * (1.0 - source.r), backdrop.r > 0.5), select(2.0 * backdrop.g * source.g, 1.0 - 2.0 * (1.0 - backdrop.g) * (1.0 - source.g), backdrop.g > 0.5), select(2.0 * backdrop.b * source.b, 1.0 - 2.0 * (1.0 - backdrop.b) * (1.0 - source.b), backdrop.b > 0.5));
    }
    if (mode == 10u) { return vec3<f32>(soft_light_channel(backdrop.r, source.r), soft_light_channel(backdrop.g, source.g), soft_light_channel(backdrop.b, source.b)); }
    if (mode == 11u) {
        return vec3<f32>(select(2.0 * backdrop.r * source.r, 1.0 - 2.0 * (1.0 - backdrop.r) * (1.0 - source.r), source.r > 0.5), select(2.0 * backdrop.g * source.g, 1.0 - 2.0 * (1.0 - backdrop.g) * (1.0 - source.g), source.g > 0.5), select(2.0 * backdrop.b * source.b, 1.0 - 2.0 * (1.0 - backdrop.b) * (1.0 - source.b), source.b > 0.5));
    }
    let vivid = vec3<f32>(vivid_light_channel(backdrop.r, source.r), vivid_light_channel(backdrop.g, source.g), vivid_light_channel(backdrop.b, source.b));
    if (mode == 12u) { return vivid; }
    if (mode == 13u) { return clamp(backdrop + 2.0 * source - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)); }
    if (mode == 14u) { return vec3<f32>(select(min(backdrop.r, 2.0 * source.r), max(backdrop.r, 2.0 * source.r - 1.0), source.r > 0.5), select(min(backdrop.g, 2.0 * source.g), max(backdrop.g, 2.0 * source.g - 1.0), source.g > 0.5), select(min(backdrop.b, 2.0 * source.b), max(backdrop.b, 2.0 * source.b - 1.0), source.b > 0.5)); }
    if (mode == 15u) { return select(vec3<f32>(0.0), vec3<f32>(1.0), vivid >= vec3<f32>(0.5)); }
    let backdrop_hsl = rgb_to_hsl(backdrop);
    let source_hsl = rgb_to_hsl(source);
    if (mode == 16u) { return hsl_to_rgb(vec3<f32>(source_hsl.x, backdrop_hsl.y, backdrop_hsl.z)); }
    if (mode == 17u) { return hsl_to_rgb(vec3<f32>(backdrop_hsl.x, source_hsl.y, backdrop_hsl.z)); }
    if (mode == 18u) { return hsl_to_rgb(vec3<f32>(source_hsl.x, source_hsl.y, backdrop_hsl.z)); }
    if (mode == 19u) { return hsl_to_rgb(vec3<f32>(backdrop_hsl.x, backdrop_hsl.y, source_hsl.z)); }
    return source;
}

fn apply_hue_shift(color: vec3<f32>, shift_degrees: f32) -> vec3<f32> {
    if (abs(shift_degrees) < 0.01) {
        return color;
    }
    let srgb_color = linear_to_srgb_extended(color);
    let hsv = rgb_to_hsv(srgb_color);
    var shifted_h = hsv.x + shift_degrees;
    shifted_h = (shifted_h + 360.0) % 360.0;
    let shifted_srgb = hsv_to_rgb(vec3<f32>(shifted_h, hsv.y, hsv.z));
    return srgb_to_linear(shifted_srgb);
}

fn get_raw_hsl_influence(hue: f32, center: f32, width: f32) -> f32 {
    let dist = min(abs(hue - center), 360.0 - abs(hue - center));
    const sharpness = 1.5;
    let falloff = dist / (width * 0.5);
    return exp(-sharpness * falloff * falloff);
}

fn hash(p: vec2<f32>) -> f32 {
    var p3  = fract(vec3<f32>(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn gradient_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    let ga = vec2<f32>(hash(i + vec2(0.0, 0.0)), hash(i + vec2(0.0, 0.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;
    let gb = vec2<f32>(hash(i + vec2(1.0, 0.0)), hash(i + vec2(1.0, 0.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;
    let gc = vec2<f32>(hash(i + vec2(0.0, 1.0)), hash(i + vec2(0.0, 1.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;
    let gd = vec2<f32>(hash(i + vec2(1.0, 1.0)), hash(i + vec2(1.0, 1.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;

    let dot_00 = dot(ga, f - vec2(0.0, 0.0));
    let dot_10 = dot(gb, f - vec2(1.0, 0.0));
    let dot_01 = dot(gc, f - vec2(0.0, 1.0));
    let dot_11 = dot(gd, f - vec2(1.0, 1.0));

    let bottom_interp = mix(dot_00, dot_10, u.x);
    let top_interp = mix(dot_01, dot_11, u.x);

    return mix(bottom_interp, top_interp, u.y);
}

fn dither(coords: vec2<u32>) -> f32 {
    let p = vec2<f32>(coords);
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5;
}

fn interpolate_cubic_hermite(x: f32, p1: Point, p2: Point, m1: f32, m2: f32) -> f32 {
    let dx = p2.x - p1.x;
    if (dx <= 0.0) { return p1.y; }
    let t = (x - p1.x) / dx;
    let t2 = t * t;
    let t3 = t2 * t;
    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;
    return h00 * p1.y + h10 * m1 * dx + h01 * p2.y + h11 * m2 * dx;
}

fn apply_curve(val: f32, points: array<Point, 16>, count: u32) -> f32 {
    if (count < 2u) { return val; }
    var local_points = points;
    let x = val * 255.0;
    if (x <= local_points[0].x) { return local_points[0].y / 255.0; }
    if (x >= local_points[count - 1u].x) { return local_points[count - 1u].y / 255.0; }
    for (var i = 0u; i < 15u; i = i + 1u) {
        if (i >= count - 1u) { break; }
        let p1 = local_points[i];
        let p2 = local_points[i + 1u];
        if (x <= p2.x) {
            let p0 = local_points[max(0u, i - 1u)];
            let p3 = local_points[min(count - 1u, i + 2u)];
            let delta_before = (p1.y - p0.y) / max(0.001, p1.x - p0.x);
            let delta_current = (p2.y - p1.y) / max(0.001, p2.x - p1.x);
            let delta_after = (p3.y - p2.y) / max(0.001, p3.x - p2.x);
            var tangent_at_p1: f32;
            var tangent_at_p2: f32;
            if (i == 0u) { tangent_at_p1 = delta_current; } else {
                if (delta_before * delta_current <= 0.0) { tangent_at_p1 = 0.0; } else { tangent_at_p1 = (delta_before + delta_current) / 2.0; }
            }
            if (i + 1u == count - 1u) { tangent_at_p2 = delta_current; } else {
                if (delta_current * delta_after <= 0.0) { tangent_at_p2 = 0.0; } else { tangent_at_p2 = (delta_current + delta_after) / 2.0; }
            }
            if (delta_current != 0.0) {
                let alpha = tangent_at_p1 / delta_current;
                let beta = tangent_at_p2 / delta_current;
                if (alpha * alpha + beta * beta > 9.0) {
                    let tau = 3.0 / sqrt(alpha * alpha + beta * beta);
                    tangent_at_p1 = tangent_at_p1 * tau;
                    tangent_at_p2 = tangent_at_p2 * tau;
                }
            }
            let result_y = interpolate_cubic_hermite(x, p1, p2, tangent_at_p1, tangent_at_p2);
            return clamp(result_y / 255.0, 0.0, 1.0);
        }
    }
    return local_points[count - 1u].y / 255.0;
}

fn apply_tonal_adjustments(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    is_raw: u32,
    con: f32,
    sh: f32,
    wh: f32,
    bl: f32
) -> vec3<f32> {
    var rgb = color;

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    if (wh != 0.0) {
        let white_level = 1.0 - wh * 0.25;
        let w_mult = 1.0 / max(white_level, 0.01);
        rgb *= w_mult;
        blurred_linear *= w_mult;
    }

    let pixel_luma = get_luma(max(rgb, vec3<f32>(0.0)));
    let blurred_luma = get_luma(max(blurred_linear, vec3<f32>(0.0)));

    let safe_pixel_luma = max(pixel_luma, 0.0001);
    let safe_blurred_luma = max(blurred_luma, 0.0001);

    if (sh != 0.0 || bl != 0.0) {
        let t_pixel = pow(safe_pixel_luma, 0.4545);
        let t_blurred = pow(safe_blurred_luma, 0.4545);

        let shadow_lift = sh * t_pixel * pow(max(1.0 - t_pixel, 0.0), 4.5);
        let black_lift = bl * t_pixel * pow(max(1.0 - t_pixel, 0.0), 12.0);
        let lift_amount = max(shadow_lift + black_lift, 0.0);

        let t_pixel_curved = max(t_pixel + shadow_lift + black_lift, 0.0);

        let shadow_pivot = 0.2;
        let stretch_factor = 1.0 + (lift_amount * 1.3);
        let contrasted_t = shadow_pivot + (t_pixel_curved - shadow_pivot) * stretch_factor;

        let final_t = max(mix(t_pixel_curved, contrasted_t, 0.85), 0.0);
        let curved_luma = pow(final_t, 2.2);

        let luma_ratio = curved_luma / safe_pixel_luma;
        rgb *= luma_ratio;

        let detail = t_pixel / max(t_blurred, 0.0001);
        let safe_detail = clamp(detail, 0.8, 1.25);

        let noise_protection = smoothstep(0.0, 0.1, t_blurred);

        let detail_amp = 1.0 + (lift_amount * 1.2 * noise_protection);

        let enhanced_detail = pow(safe_detail, detail_amp);
        let detail_correction = enhanced_detail / safe_detail;

        let linear_correction = pow(detail_correction, 2.2);
        rgb *= linear_correction;

        if (luma_ratio > 1.0) {
            let recovered_luma = get_luma(rgb);
            let boost_amount = clamp((luma_ratio - 1.0) * 0.15, 0.0, 0.4);
            rgb = mix(rgb, vec3<f32>(recovered_luma), boost_amount);
        }
    }

    if (con != 0.0) {
        let safe_rgb = max(rgb, vec3<f32>(0.0));
        let g = 2.2;
        let perceptual = pow(safe_rgb, vec3<f32>(1.0 / g));
        let clamped_perceptual = clamp(perceptual, vec3<f32>(0.0), vec3<f32>(1.0));
        let strength = pow(2.0, con * 1.25);
        let condition = clamped_perceptual < vec3<f32>(0.5);
        let high_part = 1.0 - 0.5 * pow(2.0 * (1.0 - clamped_perceptual), vec3<f32>(strength));
        let low_part = 0.5 * pow(2.0 * clamped_perceptual, vec3<f32>(strength));
        let curved_perceptual = select(high_part, low_part, condition);
        let contrast_adjusted_rgb = pow(curved_perceptual, vec3<f32>(g));
        let mix_factor = smoothstep(vec3<f32>(1.0), vec3<f32>(1.01), safe_rgb);
        rgb = mix(contrast_adjusted_rgb, rgb, mix_factor);
    }
    return rgb;
}

fn apply_highlights_adjustment(
    color_in: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    is_raw: u32,
    highlights_adj: f32
) -> vec3<f32> {
    if (highlights_adj == 0.0) { return color_in; }

    let pixel_luma = get_luma(max(color_in, vec3<f32>(0.0)));
    let safe_pixel_luma = max(pixel_luma, 0.0001);

    let pixel_mask_input = tanh(safe_pixel_luma * 1.5);
    let highlight_mask = smoothstep(0.3, 0.95, pixel_mask_input);

    if (highlight_mask < 0.001) {
        return color_in;
    }

    let luma = pixel_luma;
    var final_adjusted_color: vec3<f32>;

    if (highlights_adj < 0.0) {
        var new_luma: f32;
        if (luma <= 1.0) {
            let gamma = 1.0 - highlights_adj * 1.75;
            new_luma = pow(luma, gamma);
        } else {
            let luma_excess = luma - 1.0;
            let compression_strength = -highlights_adj * 6.0;
            let compressed_excess = luma_excess / (1.0 + luma_excess * compression_strength);
            new_luma = 1.0 + compressed_excess;
        }
        let tonally_adjusted_color = color_in * (new_luma / max(luma, 0.0001));
        let desaturation_amount = smoothstep(1.0, 10.0, luma);
        let white_point = vec3<f32>(new_luma);
        final_adjusted_color = mix(tonally_adjusted_color, white_point, desaturation_amount);
    } else {
        let adjustment = highlights_adj * 1.75;
        let factor = pow(2.0, adjustment);
        final_adjusted_color = color_in * factor;
    }

    return mix(color_in, final_adjusted_color, highlight_mask);
}

fn apply_linear_exposure(color_in: vec3<f32>, exposure_adj: f32) -> vec3<f32> {
    if (exposure_adj == 0.0) {
        return color_in;
    }
    return color_in * pow(2.0, exposure_adj);
}

fn apply_filmic_exposure(color_in: vec3<f32>, brightness_adj: f32) -> vec3<f32> {
    if (brightness_adj == 0.0) {
        return color_in;
    }
    const RATIONAL_CURVE_MIX: f32 = 0.95;
    const MIDTONE_STRENGTH: f32 = 1.2;
    const TOP_ANCHOR: f32 = 1.06;
    let original_luma = get_luma(color_in);
    if (abs(original_luma) < 0.00001) {
        return color_in;
    }
    let direct_adj = brightness_adj * (1.0 - RATIONAL_CURVE_MIX);
    let rational_adj = brightness_adj * RATIONAL_CURVE_MIX;
    let scale = pow(2.0, direct_adj);
    let k = pow(2.0, -rational_adj * MIDTONE_STRENGTH);
    let luma_abs = abs(original_luma);
    let luma_floor = floor(luma_abs / TOP_ANCHOR) * TOP_ANCHOR;
    let luma_norm = (luma_abs - luma_floor) / TOP_ANCHOR;
    let shaped_norm = luma_norm / (luma_norm + (1.0 - luma_norm) * k);
    let shaped_luma_abs = luma_floor + (shaped_norm * TOP_ANCHOR);
    let new_luma = sign(original_luma) * shaped_luma_abs * scale;
    let chroma = color_in - vec3<f32>(original_luma);
    let total_luma_scale = new_luma / original_luma;
    let luma_weight = clamp(new_luma, 0.0, 2.0) * 0.5;
    let dynamic_exp = mix(0.95, 0.65, luma_weight);
    let base_chroma_scale = pow(total_luma_scale, dynamic_exp);
    let highlight_rolloff = 1.0 / (1.0 + max(0.0, new_luma - 0.9) * 2.0);
    let chroma_scale = base_chroma_scale * highlight_rolloff;
    return vec3<f32>(new_luma) + chroma * chroma_scale;
}

fn apply_color_calibration(color: vec3<f32>, cal: ColorCalibrationSettings) -> vec3<f32> {
    let h_r = cal.red_hue;
    let h_g = cal.green_hue;
    let h_b = cal.blue_hue;
    let r_prime = vec3<f32>(1.0 - abs(h_r), max(0.0, h_r), max(0.0, -h_r));
    let g_prime = vec3<f32>(max(0.0, -h_g), 1.0 - abs(h_g), max(0.0, h_g));
    let b_prime = vec3<f32>(max(0.0, h_b), max(0.0, -h_b), 1.0 - abs(h_b));
    let hue_matrix = mat3x3<f32>(r_prime, g_prime, b_prime);
    var c = hue_matrix * color;

    let luma = get_luma(max(vec3(0.0), c));
    let desaturated_color = vec3<f32>(luma);
    let sat_vector = c - desaturated_color;

    let color_sum = c.r + c.g + c.b;
    var masks = vec3<f32>(0.0);
    if (color_sum > 0.001) {
        masks = c / color_sum;
    }

    let total_sat_adjustment =
        masks.r * cal.red_saturation +
        masks.g * cal.green_saturation +
        masks.b * cal.blue_saturation;

    c += sat_vector * total_sat_adjustment;

    let st = cal.shadows_tint;
    if (abs(st) > 0.001) {
        let shadow_luma = get_luma(max(vec3(0.0), c));
        let mask = 1.0 - smoothstep(0.0, 0.3, shadow_luma);
        let tint_mult = vec3<f32>(1.0 + st * 0.25, 1.0 - st * 0.25, 1.0 + st * 0.25);
        c = mix(c, c * tint_mult, mask);
    }

    return c;
}

fn apply_white_balance(color: vec3<f32>, temp: f32, tnt: f32) -> vec3<f32> {
    var rgb = color;
    let temp_kelvin_mult = vec3<f32>(1.0 + temp * 0.2, 1.0 + temp * 0.05, 1.0 - temp * 0.2);
    let tint_mult = vec3<f32>(1.0 + tnt * 0.25, 1.0 - tnt * 0.25, 1.0 + tnt * 0.25);
    rgb *= temp_kelvin_mult * tint_mult;
    return rgb;
}

fn apply_creative_color(color: vec3<f32>, sat: f32, vib: f32) -> vec3<f32> {
    var processed = color;
    let luma = get_luma(processed);

    if (sat != 0.0) {
        processed = mix(vec3<f32>(luma), processed, 1.0 + sat);
    }
    if (vib == 0.0) { return processed; }
    let c_max = max(processed.r, max(processed.g, processed.b));
    let c_min = min(processed.r, min(processed.g, processed.b));
    let delta = c_max - c_min;
    if (delta < 0.02) {
        return processed;
    }
    let current_sat = delta / max(c_max, 0.001);
    if (vib > 0.0) {
        let sat_mask = 1.0 - smoothstep(0.4, 0.9, current_sat);
        let hsv = rgb_to_hsv(processed);
        let hue = hsv.x;
        let skin_center = 25.0;
        let hue_dist = min(abs(hue - skin_center), 360.0 - abs(hue - skin_center));
        let is_skin = smoothstep(35.0, 10.0, hue_dist);
        let skin_dampener = mix(1.0, 0.6, is_skin);
        let amount = vib * sat_mask * skin_dampener * 3.0;
        processed = mix(vec3<f32>(luma), processed, 1.0 + amount);
    } else {
        let desat_mask = 1.0 - smoothstep(0.2, 0.8, current_sat);
        let amount = vib * desat_mask;
        processed = mix(vec3<f32>(luma), processed, 1.0 + amount);
    }
    return processed;
}

// The hue (0-1), saturation and value `apply_hsl_panel` weighs its bands by;
// neutral pixels, which it leaves alone, read as zero.
fn hsl_probe(color: vec3<f32>) -> vec4<f32> {
    let safe_color = max(color, vec3<f32>(0.0));
    if (distance(safe_color.r, safe_color.g) < 0.001 && distance(safe_color.g, safe_color.b) < 0.001) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    let hsv = rgb_to_hsv(safe_color);
    return vec4<f32>(hsv.x / 360.0, hsv.y, hsv.z, 1.0);
}

// The values a tone curve reads: red, green, blue and the luma its luma curve uses.
fn curve_probe(color: vec3<f32>) -> vec4<f32> {
    let safe_color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(safe_color, get_luma(safe_color));
}

fn apply_hsl_panel(color: vec3<f32>, hsl_adjustments: array<HslColor, 8>, coords_i: vec2<i32>) -> vec3<f32> {
    let safe_color = max(color, vec3<f32>(0.0));
    if (distance(safe_color.r, safe_color.g) < 0.001 && distance(safe_color.g, safe_color.b) < 0.001) {
        return safe_color;
    }
    let original_hsv = rgb_to_hsv(safe_color);
    let original_luma = get_luma(safe_color);

    let saturation_mask = smoothstep(0.05, 0.20, original_hsv.y);
    let luminance_weight = smoothstep(0.0, 1.0, original_hsv.y);

    if (saturation_mask < 0.001 && luminance_weight < 0.001) {
        return safe_color;
    }

    let original_hue = original_hsv.x;

    var raw_influences: array<f32, 8>;
    var total_raw_influence: f32 = 0.0;
    for (var i = 0u; i < 8u; i = i + 1u) {
        let range = HSL_RANGES[i];
        let influence = get_raw_hsl_influence(original_hue, range.center, range.width);
        raw_influences[i] = influence;
        total_raw_influence += influence;
    }

    var total_hue_shift: f32 = 0.0;
    var total_sat_multiplier: f32 = 0.0;
    var total_lum_adjust: f32 = 0.0;

    for (var i = 0u; i < 8u; i = i + 1u) {
        let normalized_influence = raw_influences[i] / total_raw_influence;

        let hue_sat_influence = normalized_influence * saturation_mask;
        let luma_influence = normalized_influence * luminance_weight;

        total_hue_shift += hsl_adjustments[i].hue * 2.0 * hue_sat_influence;
        total_sat_multiplier += hsl_adjustments[i].saturation * hue_sat_influence;
        total_lum_adjust += hsl_adjustments[i].luminance * luma_influence;
    }

    return shift_hsv(original_hsv, original_luma, total_hue_shift, total_sat_multiplier, total_lum_adjust);
}

// Rotates a colour's hue by `hue_shift` degrees, scales its saturation by 1 + `sat_multiplier`
// and its luma by 1 + `lum_adjust`; shared by the colour mixer and Point Color.
fn shift_hsv(original_hsv: vec3<f32>, original_luma: f32, hue_shift: f32, sat_multiplier: f32, lum_adjust: f32) -> vec3<f32> {
    if (original_hsv.y * (1.0 + sat_multiplier) < 0.0001) {
        let final_luma = original_luma * (1.0 + lum_adjust);
        return vec3<f32>(final_luma);
    }
    var hsv = original_hsv;
    hsv.x = (hsv.x + hue_shift + 360.0) % 360.0;
    hsv.y = clamp(hsv.y * (1.0 + sat_multiplier), 0.0, 1.0);
    let hs_shifted_rgb = hsv_to_rgb(vec3<f32>(hsv.x, hsv.y, original_hsv.z));
    let new_luma = get_luma(hs_shifted_rgb);
    let target_luma = original_luma * (1.0 + lum_adjust);
    if (new_luma < 0.0001) {
        return vec3<f32>(max(0.0, target_luma));
    }
    return hs_shifted_rgb * (target_luma / new_luma);
}

// The values Point Color selects by: hue (degrees) and saturation of the display-encoded
// colour, and its luma, so ranges follow what the eye sees rather than linear light.
fn point_color_coords(color: vec3<f32>) -> vec3<f32> {
    let srgb = linear_to_srgb(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)));
    let hsv = rgb_to_hsv(srgb);
    return vec3<f32>(hsv.x, hsv.y, get_luma(srgb));
}

// Full inside [min, max] of `range` (min, max, min fade, max fade), easing to zero over the
// fades; mirrors `mask_generation::range_band_weight`.
fn range_band(range: vec4<f32>, x: f32) -> f32 {
    let lower = clamp((x - (range.x - range.z)) / max(range.z, 0.0001), 0.0, 1.0);
    let upper = clamp(((range.y + range.w) - x) / max(range.w, 0.0001), 0.0, 1.0);
    return lower * lower * (3.0 - 2.0 * lower) * upper * upper * (3.0 - 2.0 * upper);
}

fn point_color_weight(point: PointColor, coords: vec3<f32>) -> f32 {
    let hue_offset = ((coords.x - point.hue + 540.0) % 360.0) - 180.0;
    return range_band(point.hue_range, hue_offset)
        * range_band(point.saturation_range, coords.y - point.saturation)
        * range_band(point.luminance_range, coords.z - point.luminance);
}

fn apply_point_colors(color: vec3<f32>, coords: vec3<f32>) -> vec3<f32> {
    var hue_shift = 0.0;
    var sat_multiplier = 0.0;
    var lum_adjust = 0.0;
    for (var i = 0u; i < adjustments.global.point_color_count; i = i + 1u) {
        let point = adjustments.global.point_colors[i];
        let weight = point_color_weight(point, coords);
        hue_shift += point.hue_shift * weight;
        sat_multiplier += point.saturation_shift * weight;
        lum_adjust += point.luminance_shift * weight;
    }
    if (hue_shift == 0.0 && sat_multiplier == 0.0 && lum_adjust == 0.0) {
        return color;
    }
    let safe_color = max(color, vec3<f32>(0.0));
    return shift_hsv(rgb_to_hsv(safe_color), get_luma(safe_color), hue_shift, sat_multiplier, lum_adjust);
}

fn apply_color_grading(color: vec3<f32>, shadows: ColorGradeSettings, midtones: ColorGradeSettings, highlights: ColorGradeSettings, global: ColorGradeSettings, blending: f32, balance: f32) -> vec3<f32> {
    let luma = get_luma(max(vec3(0.0), color));
    let base_shadow_crossover = 0.1;
    let base_highlight_crossover = 0.5;
    let balance_range = 0.5;
    let shadow_crossover = base_shadow_crossover + max(0.0, -balance) * balance_range;
    let highlight_crossover = base_highlight_crossover - max(0.0, balance) * balance_range;
    let feather = 0.2 * blending;
    let final_shadow_crossover = min(shadow_crossover, highlight_crossover - 0.01);
    let shadow_mask = 1.0 - smoothstep(final_shadow_crossover - feather, final_shadow_crossover + feather, luma);
    let highlight_mask = smoothstep(highlight_crossover - feather, highlight_crossover + feather, luma);
    let midtone_mask = max(0.0, 1.0 - shadow_mask - highlight_mask);
    let global_mask = 1.0;
    var graded_color = color;
    let shadow_sat_strength = 0.3;
    let shadow_lum_strength = 0.5;
    let midtone_sat_strength = 0.6;
    let midtone_lum_strength = 0.8;
    let highlight_sat_strength = 0.8;
    let highlight_lum_strength = 1.0;
    let global_sat_strength = 1.0;
    let global_lum_strength = 1.0;
    if (shadows.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(shadows.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * shadows.saturation * shadow_mask * shadow_sat_strength; }
    graded_color += shadows.luminance * shadow_mask * shadow_lum_strength;
    if (midtones.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(midtones.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * midtones.saturation * midtone_mask * midtone_sat_strength; }
    graded_color += midtones.luminance * midtone_mask * midtone_lum_strength;
    if (highlights.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(highlights.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * highlights.saturation * highlight_mask * highlight_sat_strength; }
    graded_color += highlights.luminance * highlight_mask * highlight_lum_strength;
    if (global.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(global.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * global.saturation * global_mask * global_sat_strength; }
    graded_color += global.luminance * global_mask * global_lum_strength;
    return graded_color;
}

fn apply_local_contrast(
    processed_color_linear: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    amount: f32,
    is_raw: u32,
    mode: u32,
    threshold: f32
) -> vec3<f32> {
    if (amount == 0.0) {
        return processed_color_linear;
    }

    var blurred_color_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_color_linear = blurred_color_input_space;
    } else {
        blurred_color_linear = srgb_to_linear(blurred_color_input_space);
    }

    if (amount < 0.0) {
        var blur_amount = -amount;
        if (mode == 0u) {
            blur_amount = blur_amount * 0.5;
        }
        return mix(processed_color_linear, blurred_color_linear, blur_amount);
    }

    let center_luma = get_luma(processed_color_linear);

    let shadow_threshold = select(0.03, 0.1, is_raw == 1u);
    let shadow_protection = smoothstep(0.0, shadow_threshold, center_luma);
    let highlight_protection = 1.0 - smoothstep(0.9, 1.0, center_luma);
    let midtone_mask = shadow_protection * highlight_protection;

    if (midtone_mask < 0.001) {
        return processed_color_linear;
    }

    let blurred_luma = get_luma(blurred_color_linear);
    let safe_center_luma = max(center_luma, 0.0001);
    let safe_blurred_luma = max(blurred_luma, 0.0001);

    let log_ratio = log2(safe_center_luma / safe_blurred_luma);
    var effective_amount = amount;

    if (mode == 0u) {
        let edge_magnitude = abs(log_ratio);
        let normalized_edge = clamp(edge_magnitude / 3.0, 0.0, 1.0);
        let edge_dampener = 1.0 - pow(normalized_edge, 0.5);
        let edge_mask = smoothstep(threshold * 0.5, threshold * 1.5, edge_magnitude);
        effective_amount = amount * edge_dampener * edge_mask * 0.8;
    } else {
        effective_amount = amount;
    }

    let contrast_factor = exp2(log_ratio * effective_amount);
    let final_color = processed_color_linear * contrast_factor;

    return mix(processed_color_linear, final_color, midtone_mask);
}

fn apply_centre_local_contrast(
    color_in: vec3<f32>,
    centre_amount: f32,
    coords_i: vec2<i32>,
    blurred_color_srgb: vec3<f32>,
    is_raw: u32
) -> vec3<f32> {
    if (centre_amount == 0.0) {
        return color_in;
    }
    let full_dims_f = vec2<f32>(textureDimensions(input_texture));
    let coord_f = vec2<f32>(coords_i);
    let midpoint = 0.4;
    let feather = 0.375;
    let aspect = full_dims_f.y / full_dims_f.x;
    let uv_centered = (coord_f / full_dims_f - 0.5) * 2.0;
    let d = length(uv_centered * vec2<f32>(1.0, aspect)) * 0.5;
    let vignette_mask = smoothstep(midpoint - feather, midpoint + feather, d);
    let centre_mask = 1.0 - vignette_mask;

    const CLARITY_SCALE: f32 = 0.9;
    var processed_color = color_in;
    let clarity_strength = centre_amount * (2.0 * centre_mask - 1.0) * CLARITY_SCALE;

    if (abs(clarity_strength) > 0.001) {
        processed_color = apply_local_contrast(processed_color, blurred_color_srgb, clarity_strength, is_raw, 1u, 0.0);
    }

    return processed_color;
}

fn apply_centre_tonal_and_color(
    color_in: vec3<f32>,
    centre_amount: f32,
    coords_i: vec2<i32>
) -> vec3<f32> {
    if (centre_amount == 0.0) {
        return color_in;
    }
    let full_dims_f = vec2<f32>(textureDimensions(input_texture));
    let coord_f = vec2<f32>(coords_i);
    let midpoint = 0.4;
    let feather = 0.375;
    let aspect = full_dims_f.y / full_dims_f.x;
    let uv_centered = (coord_f / full_dims_f - 0.5) * 2.0;
    let d = length(uv_centered * vec2<f32>(1.0, aspect)) * 0.5;
    let vignette_mask = smoothstep(midpoint - feather, midpoint + feather, d);
    let centre_mask = 1.0 - vignette_mask;

    const EXPOSURE_SCALE: f32 = 0.5;
    const VIBRANCE_SCALE: f32 = 0.4;
    const SATURATION_CENTER_SCALE: f32 = 0.3;
    const SATURATION_EDGE_SCALE: f32 = 0.8;

    var processed_color = color_in;

    let exposure_boost = centre_mask * centre_amount * EXPOSURE_SCALE;
    processed_color = apply_filmic_exposure(processed_color, exposure_boost);

    let vibrance_center_boost = centre_mask * centre_amount * VIBRANCE_SCALE;
    let saturation_center_boost = centre_mask * centre_amount * SATURATION_CENTER_SCALE;
    let saturation_edge_effect = -(1.0 - centre_mask) * centre_amount * SATURATION_EDGE_SCALE;
    let total_saturation_effect = saturation_center_boost + saturation_edge_effect;
    processed_color = apply_creative_color(processed_color, total_saturation_effect, vibrance_center_boost);

    return processed_color;
}

fn apply_vignette_effect(
    color_in: vec3<f32>,
    amount: f32,
    midpoint: f32,
    roundness: f32,
    feather: f32,
    coords: vec2<u32>
) -> vec3<f32> {
    if (amount == 0.0) {
        return color_in;
    }
    let full_dims = vec2<f32>(textureDimensions(input_texture));
    let coord = vec2<f32>(coords);
    let aspect = full_dims.y / full_dims.x;
    let uv_centered = (coord / full_dims - 0.5) * 2.0;
    let power = 1.0 - roundness;
    let uv_round = sign(uv_centered) * pow(abs(uv_centered), vec2<f32>(power, power));
    let distance = length(uv_round * vec2<f32>(1.0, aspect)) * 0.5;
    let falloff = smoothstep(midpoint - feather * 0.5, midpoint + feather * 0.5, distance);
    const VIGNETTE_STRENGTH: f32 = 1.3;
    let effect = clamp(amount * VIGNETTE_STRENGTH * falloff, -1.0, 1.0);
    if (effect < 0.0) {
        return color_in * (1.0 + effect);
    }
    return mix(color_in, vec3<f32>(1.0), effect);
}

fn grain_delta(
    color_in: vec3<f32>,
    coords: vec2<i32>,
    amount: f32,
    size: f32,
    roughness: f32,
    scale: f32
) -> vec3<f32> {
    if (amount <= 0.0) {
        return vec3<f32>(0.0);
    }
    let coord = vec2<f32>(coords);
    let grain_frequency = (1.0 / max(size, 0.1)) / scale;
    let luma = max(0.0, get_luma(color_in));
    let luma_mask = smoothstep(0.0, 0.15, luma) * (1.0 - smoothstep(0.6, 1.0, luma));
    let base_coord = coord * grain_frequency;
    let rough_coord = coord * grain_frequency * 0.6;
    let noise_base = gradient_noise(base_coord);
    let noise_rough = gradient_noise(rough_coord + vec2<f32>(5.2, 1.3));
    let noise_val = mix(noise_base, noise_rough, roughness);
    return vec3<f32>(noise_val) * amount * 0.5 * luma_mask;
}

fn apply_dehaze(color: vec3<f32>, blurred_color_input_space: vec3<f32>, is_raw: u32, amount: f32) -> vec3<f32> {
    if (amount == 0.0) { return color; }

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    let atmospheric_light = vec3<f32>(0.95, 0.97, 1.0);

    if (amount > 0.0) {
        let pixel_dark = min(color.r, min(color.g, color.b));
        let regional_dark = min(blurred_linear.r, min(blurred_linear.g, blurred_linear.b));
        let pixel_luma = get_luma(max(color, vec3<f32>(0.0)));
        let blurred_luma = get_luma(max(blurred_linear, vec3<f32>(0.0)));
        let edge_diff = abs(pow(pixel_luma, 0.5) - pow(blurred_luma, 0.5));
        let halo_protection = smoothstep(0.02, 0.15, edge_diff);
        let spatial_dark = mix(regional_dark, pixel_dark, halo_protection);
        let safe_dark = max(spatial_dark - 0.02, 0.0);
        let mapped_haze = safe_dark / (safe_dark + 0.2);
        let t = max(1.0 - amount * mapped_haze * 0.85, 0.15);
        var recovered = (color - atmospheric_light) / t + atmospheric_light;
        let rec_luma = get_luma(max(recovered, vec3<f32>(0.0)));
        let shadow_lift = smoothstep(0.1, 0.0, rec_luma) * (1.0 - t) * 0.15;
        recovered += shadow_lift;
        let haze_removed = 1.0 - t;
        let sat_boost = haze_removed * 0.5;
        let final_luma = get_luma(max(recovered, vec3<f32>(0.0)));
        recovered = mix(vec3<f32>(final_luma), recovered, 1.0 + sat_boost);
        return max(recovered, vec3<f32>(0.0));
    } else {
        let regional_dark = min(blurred_linear.r, min(blurred_linear.g, blurred_linear.b));
        let safe_dark = max(regional_dark - 0.02, 0.0);
        let mapped_depth = safe_dark / (safe_dark + 0.2);
        let depth_factor = mix(0.4, 1.0, mapped_depth);
        return mix(color, atmospheric_light, abs(amount) * 0.7 * depth_factor);
    }
}

fn apply_noise_reduction(
    center_linear: vec3<f32>,
    coords_i: vec2<i32>,
    luma_amount: f32,
    color_amount: f32,
    scale: f32,
    is_raw: u32
) -> vec3<f32> {
    let luma_a  = clamp(luma_amount,  0.0, 1.0);
    let color_a = clamp(color_amount, 0.0, 1.0);
    if (luma_a < 0.001 && color_a < 0.001) {
        return center_linear;
    }

    let dims = vec2<i32>(textureDimensions(input_texture));
    let max_idx = dims - vec2<i32>(1);
    let center_safe   = max(center_linear, vec3<f32>(0.0));
    let center_luma   = get_luma(center_safe);
    let center_chroma = center_linear - vec3<f32>(center_luma);

    let res_factor = clamp(sqrt(scale), 0.5, 2.0);

    var new_luma   = center_luma;
    var new_chroma = center_chroma;

    // --- LUMA NOISE REDUCTION ---
    if (luma_a > 0.001) {
        let l_curve = sqrt(luma_a);

        let stride_f = mix(1.0, 2.0, smoothstep(0.45, 0.95, luma_a)) * res_factor;
        let extra    = clamp(stride_f - 1.0, 0.0, 1.0);

        let l_spatial = mix(1.0, 1.5, l_curve);
        let l_spat_n  = -1.0 / max(2.0 * l_spatial * l_spatial, 1e-6);

        let h1 = hash(vec2<f32>(coords_i));
        let h2 = hash(vec2<f32>(coords_i) + vec2<f32>(17.31, 71.13));

        var samp_luma: array<f32, 25>;
        var samp_spat: array<f32, 25>;
        var lmin: f32 = center_luma;
        var lmax: f32 = center_luma;

        samp_luma[0] = center_luma;
        samp_spat[0] = 1.0;

        var idx: u32 = 1u;
        for (var dy: i32 = -2; dy <= 2; dy = dy + 1) {
            for (var dx: i32 = -2; dx <= 2; dx = dx + 1) {
                if (dx == 0 && dy == 0) { continue; }

                let ring = max(abs(dx), abs(dy));
                let ring_factor = select(0.5, 1.0, ring == 2);
                let grow = 1.0 + extra * ring_factor;

                let jx = (h1 - 0.5) * 2.0 * extra;
                let jy = (h2 - 0.5) * 2.0 * extra;

                let off_f = vec2<f32>(f32(dx) * grow + jx, f32(dy) * grow + jy);
                let off   = vec2<i32>(i32(round(off_f.x)), i32(round(off_f.y)));
                let coord = clamp(coords_i + off, vec2<i32>(0), max_idx);

                var s = textureLoad(input_texture, vec2<u32>(coord), 0).rgb;
                if (is_raw == 0u) { s = srgb_to_linear(s); }
                let s_luma = get_luma(max(s, vec3<f32>(0.0)));
                samp_luma[idx] = s_luma;
                samp_spat[idx] = exp(f32(dx * dx + dy * dy) * l_spat_n);
                lmin = min(lmin, s_luma);
                lmax = max(lmax, s_luma);
                idx = idx + 1u;
            }
        }

        let luma_range    = lmax - lmin;
        let edge_strength = smoothstep(0.04, 0.20, luma_range);
        let edge_midpoint = (lmin + lmax) * 0.5;
        let center_side   = center_luma > edge_midpoint;

        let l_range_tol = mix(
            mix(0.025, 0.075, l_curve),
            mix(0.010, 0.025, l_curve),
            edge_strength
        );

        var samp_gate: array<f32, 25>;
        var sum_a: f32 = 0.0;
        var w_a:   f32 = 0.0;
        for (var k: u32 = 0u; k < 25u; k = k + 1u) {
            let diff = abs(samp_luma[k] - center_luma);
            let g_range = 1.0 - smoothstep(l_range_tol * 0.6, l_range_tol, diff);
            let s_side  = samp_luma[k] > edge_midpoint;
            let g_side  = select(0.0, 1.0, s_side == center_side);
            let g_edge  = mix(1.0, g_side, edge_strength);
            let w = samp_spat[k] * g_range * g_edge;
            samp_gate[k] = w;
            sum_a += samp_luma[k] * w;
            w_a   += w;
        }
        let initial_mean = sum_a / max(w_a, 1e-4);

        let outlier_tol = mix(0.07, 0.025, edge_strength);
        var sum_b: f32 = 0.0;
        var w_b:   f32 = 0.0;
        for (var k: u32 = 0u; k < 25u; k = k + 1u) {
            let init_w = samp_gate[k];
            if (init_w > 0.0001) {
                let d = samp_luma[k] - initial_mean;
                let r = abs(d) / outlier_tol;
                let bisq = max(0.0, 1.0 - r * r);
                let outlier_w = bisq * bisq;
                let w = init_w * outlier_w;
                sum_b += samp_luma[k] * w;
                w_b   += w;
            }
        }
        let robust_luma = select(initial_mean, sum_b / max(w_b, 1e-6), w_b > 0.01);

        let strength = luma_a * mix(1.0, 0.6, edge_strength);
        new_luma = mix(center_luma, robust_luma, strength);
    }

    if (color_a > 0.001) {
        let center_r_y = center_linear.r - center_luma;
        let center_b_y = center_linear.b - center_luma;
        let c_curve = sqrt(color_a);
        let stride_f = mix(2.0, 3.5, c_curve) * res_factor;

        let c_spatial = mix(2.0, 3.5, c_curve);
        let c_spat_n  = -1.0 / max(2.0 * c_spatial * c_spatial, 1e-6);

        let luma_tol = mix(0.12, 0.04, c_curve);
        let luma_n   = -1.0 / max(2.0 * luma_tol * luma_tol, 1e-6);

        let chroma_tol = mix(0.20, 0.08, c_curve);
        let chroma_n   = -1.0 / max(2.0 * chroma_tol * chroma_tol, 1e-6);

        let jh1 = hash(vec2<f32>(coords_i) + vec2<f32>(43.7, 91.1));
        let jh2 = hash(vec2<f32>(coords_i) + vec2<f32>(73.3, 17.9));
        let jx  = (jh1 - 0.5) * stride_f * 0.5;
        let jy  = (jh2 - 0.5) * stride_f * 0.5;

        var sum_r: f32 = center_r_y;
        var sum_b: f32 = center_b_y;
        var w_sum: f32 = 1.0;

        for (var dy: i32 = -2; dy <= 2; dy = dy + 1) {
            for (var dx: i32 = -2; dx <= 2; dx = dx + 1) {
                if (dx == 0 && dy == 0) { continue; }
                let off_f = vec2<f32>(f32(dx) * stride_f + jx, f32(dy) * stride_f + jy);
                let off   = vec2<i32>(i32(round(off_f.x)), i32(round(off_f.y)));
                let coord = clamp(coords_i + off, vec2<i32>(0), max_idx);
                var s = textureLoad(input_texture, vec2<u32>(coord), 0).rgb;

                if (is_raw == 0u) { s = srgb_to_linear(s); }

                let s_safe = max(s, vec3<f32>(0.0));
                let s_luma = get_luma(s_safe);
                let s_r_y  = s.r - s_luma;
                let s_b_y  = s.b - s_luma;

                let r2  = f32(dx * dx + dy * dy);
                let w_s = exp(r2 * c_spat_n);
                let dl  = s_luma - center_luma;
                let w_l = exp(dl * dl * luma_n);
                let dr  = s_r_y - center_r_y;
                let db  = s_b_y - center_b_y;
                let dc2 = dr * dr + db * db;
                let w_c = exp(dc2 * chroma_n);
                let w = w_s * w_l * w_c;

                sum_r += s_r_y * w;
                sum_b += s_b_y * w;
                w_sum += w;
            }
        }
        let filtered_r_y = sum_r / max(w_sum, 1e-6);
        let filtered_b_y = sum_b / max(w_sum, 1e-6);

        let new_r_y = mix(center_r_y, filtered_r_y, color_a);
        let new_b_y = mix(center_b_y, filtered_b_y, color_a);
        let new_g_y = -(LUMA_COEFF.r * new_r_y + LUMA_COEFF.b * new_b_y) / LUMA_COEFF.g;

        new_chroma = vec3<f32>(new_r_y, new_g_y, new_b_y);
    }

    return vec3<f32>(new_luma) + new_chroma;
}

fn apply_ca_correction(coords: vec2<u32>, ca_rc: f32, ca_by: f32) -> vec3<f32> {
    let dims = vec2<f32>(textureDimensions(input_texture));
    let center = dims / 2.0;
    let current_pos = vec2<f32>(coords);

    let to_center = current_pos - center;
    let dist = length(to_center);

    if (dist == 0.0) {
        return textureLoad(input_texture, coords, 0).rgb;
    }

    let dir = to_center / dist;

    let red_shift = dir * dist * ca_rc;
    let blue_shift = dir * dist * ca_by;

    let red_coords = vec2<i32>(round(current_pos - red_shift));
    let blue_coords = vec2<i32>(round(current_pos - blue_shift));
    let green_coords = vec2<i32>(current_pos);

    let max_coords = vec2<i32>(dims - 1.0);

    let r = textureLoad(input_texture, vec2<u32>(clamp(red_coords, vec2<i32>(0), max_coords)), 0).r;
    let g = textureLoad(input_texture, vec2<u32>(clamp(green_coords, vec2<i32>(0), max_coords)), 0).g;
    let b = textureLoad(input_texture, vec2<u32>(clamp(blue_coords, vec2<i32>(0), max_coords)), 0).b;

    return vec3<f32>(r, g, b);
}

const AGX_EPSILON: f32 = 1.0e-6;
const AGX_MIN_EV: f32 = -15.2;
const AGX_MAX_EV: f32 = 5.0;
const AGX_RANGE_EV: f32 = AGX_MAX_EV - AGX_MIN_EV;
const AGX_GAMMA: f32 = 2.4;
const AGX_SLOPE: f32 = 2.3843;
const AGX_TOE_POWER: f32 = 1.5;
const AGX_SHOULDER_POWER: f32 = 1.5;
const AGX_TOE_TRANSITION_X: f32 = 0.6060606;
const AGX_TOE_TRANSITION_Y: f32 = 0.43446;
const AGX_SHOULDER_TRANSITION_X: f32 = 0.6060606;
const AGX_SHOULDER_TRANSITION_Y: f32 = 0.43446;
const AGX_INTERCEPT: f32 = -1.0112;
const AGX_TOE_SCALE: f32 = -1.0359;
const AGX_SHOULDER_SCALE: f32 = 1.3475;
const AGX_TARGET_BLACK_PRE_GAMMA: f32 = 0.0;
const AGX_TARGET_WHITE_PRE_GAMMA: f32 = 1.0;

fn agx_sigmoid(x: f32, power: f32) -> f32 {
    return x / pow(1.0 + pow(x, power), 1.0 / power);
}

fn agx_scaled_sigmoid(x: f32, scale: f32, slope: f32, power: f32, transition_x: f32, transition_y: f32) -> f32 {
    return scale * agx_sigmoid(slope * (x - transition_x) / scale, power) + transition_y;
}

fn agx_apply_curve_channel(x: f32) -> f32 {
    var result: f32 = 0.0;
    if (x < AGX_TOE_TRANSITION_X) {
        result = agx_scaled_sigmoid(x, AGX_TOE_SCALE, AGX_SLOPE, AGX_TOE_POWER, AGX_TOE_TRANSITION_X, AGX_TOE_TRANSITION_Y);
    } else if (x <= AGX_SHOULDER_TRANSITION_X) {
        result = AGX_SLOPE * x + AGX_INTERCEPT;
    } else {
        result = agx_scaled_sigmoid(x, AGX_SHOULDER_SCALE, AGX_SLOPE, AGX_SHOULDER_POWER, AGX_SHOULDER_TRANSITION_X, AGX_SHOULDER_TRANSITION_Y);
    }
    return clamp(result, AGX_TARGET_BLACK_PRE_GAMMA, AGX_TARGET_WHITE_PRE_GAMMA);
}

fn agx_compress_gamut(c: vec3<f32>) -> vec3<f32> {
    let min_c = min(c.r, min(c.g, c.b));
    if (min_c < 0.0) {
        return c - min_c;
    }
    return c;
}

fn agx_tonemap(c: vec3<f32>) -> vec3<f32> {
    let x_relative = max(c / 0.18, vec3<f32>(AGX_EPSILON));
    let log_encoded = (log2(x_relative) - AGX_MIN_EV) / AGX_RANGE_EV;
    let mapped = clamp(log_encoded, vec3<f32>(0.0), vec3<f32>(1.0));

    var curved: vec3<f32>;
    curved.r = agx_apply_curve_channel(mapped.r);
    curved.g = agx_apply_curve_channel(mapped.g);
    curved.b = agx_apply_curve_channel(mapped.b);

    let final_color = pow(max(curved, vec3<f32>(0.0)), vec3<f32>(AGX_GAMMA));

    return final_color;
}

fn agx_full_transform(color_in: vec3<f32>) -> vec3<f32> {
    let compressed_color = agx_compress_gamut(color_in);
    let color_in_agx_space = adjustments.global.agx_pipe_to_rendering_matrix * compressed_color;
    let tonemapped_agx = agx_tonemap(color_in_agx_space);
    let final_color = adjustments.global.agx_rendering_to_pipe_matrix * tonemapped_agx;
    return final_color;
}

// Natural: Adobe-Standard-like curve over the full scene-linear range, applied
// to the largest and smallest ProPhoto channel with the middle one
// interpolated (hue-preserving), then near-white pixels blend toward white.
// The NATURAL_* constants are generated by `tone_mapping.rs`, which also holds
// the CPU twin (`natural_tone_rgb`); keep the two in step.
fn natural_curve_unnormalised(x: f32) -> f32 {
    return x * (x + NATURAL_CURVE_B) / (x * (NATURAL_CURVE_C * x + NATURAL_CURVE_D) + 1.0);
}

fn natural_curve(x: f32) -> f32 {
    let clamped = clamp(x, 0.0, NATURAL_HEADROOM);
    return natural_curve_unnormalised(clamped) / natural_curve_unnormalised(NATURAL_HEADROOM);
}

fn natural_tonemap(rgb: vec3<f32>) -> vec3<f32> {
    let tone = max(NATURAL_PIPE_TO_TONE * max(rgb, vec3<f32>(0.0)), vec3<f32>(0.0));
    let max_c = max(tone.r, max(tone.g, tone.b));
    let min_c = min(tone.r, min(tone.g, tone.b));
    let max_out = natural_curve(max_c);
    let min_out = natural_curve(min_c);
    let position = (tone - vec3<f32>(min_c)) / max(max_c - min_c, 1.0e-6);
    var toned = vec3<f32>(min_out) + (max_out - min_out) * position;
    let white_blend = smoothstep(NATURAL_WHITE_BLEND_START, 1.0, min_out);
    toned = mix(toned, vec3<f32>(max_out), white_blend);
    return clamp(NATURAL_TONE_TO_PIPE * toned, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn legacy_tonemap(c: vec3<f32>) -> vec3<f32> {
    const a: f32 = 2.51;
    const b: f32 = 0.03;
    const c_const: f32 = 2.43;
    const d: f32 = 0.59;
    const e: f32 = 0.14;

    let x = max(c, vec3<f32>(0.0));

    let numerator = x * (a * x + b);
    let denominator = x * (c_const * x + d) + e;

    let tonemapped = select(vec3<f32>(0.0), numerator / denominator, denominator > vec3<f32>(0.00001));

    return clamp(tonemapped, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn no_tonemap(c: vec3<f32>) -> vec3<f32> {
    return c;
}

fn is_default_curve(points: array<Point, 16>, count: u32) -> bool {
    if (count < 2u) {
        return false;
    }

    var is_identity = true;
    for (var i = 0u; i < count; i = i + 1u) {
        if (abs(points[i].x - points[i].y) > 0.5) {
            is_identity = false;
            break;
        }
    }

    let p0 = points[0];
    let p_last = points[count - 1u];
    let p0_is_origin = abs(p0.x - 0.0) < 0.1 && abs(p0.y - 0.0) < 0.1;
    let p_last_is_end = abs(p_last.x - 255.0) < 0.1 && abs(p_last.y - 255.0) < 0.1;

    return is_identity && p0_is_origin && p_last_is_end;
}

fn apply_all_curves(color: vec3<f32>, luma_curve: array<Point, 16>, luma_curve_count: u32, red_curve: array<Point, 16>, red_curve_count: u32, green_curve: array<Point, 16>, green_curve_count: u32, blue_curve: array<Point, 16>, blue_curve_count: u32) -> vec3<f32> {
    let red_is_default = is_default_curve(red_curve, red_curve_count);
    let green_is_default = is_default_curve(green_curve, green_curve_count);
    let blue_is_default = is_default_curve(blue_curve, blue_curve_count);
    let rgb_curves_are_active = !red_is_default || !green_is_default || !blue_is_default;

    if (rgb_curves_are_active) {
        let color_graded = vec3<f32>(apply_curve(color.r, red_curve, red_curve_count), apply_curve(color.g, green_curve, green_curve_count), apply_curve(color.b, blue_curve, blue_curve_count));
        let luma_initial = get_luma(color);
        let luma_target = apply_curve(luma_initial, luma_curve, luma_curve_count);
        let luma_graded = get_luma(color_graded);
        var final_color: vec3<f32>;
        if (luma_graded > 0.001) { final_color = color_graded * (luma_target / luma_graded); } else { final_color = vec3<f32>(luma_target); }
        let max_comp = max(final_color.r, max(final_color.g, final_color.b));
        if (max_comp > 1.0) { final_color = final_color / max_comp; }
        return final_color;
    } else {
        return vec3<f32>(apply_curve(color.r, luma_curve, luma_curve_count), apply_curve(color.g, luma_curve, luma_curve_count), apply_curve(color.b, luma_curve, luma_curve_count));
    }
}

fn get_mask_influence(mask_index: u32, coords: vec2<u32>) -> f32 {
    return textureLoad(mask_textures, vec2<i32>(coords), i32(mask_index), 0).r;
}

fn sample_lut_tetrahedral(uv: vec3<f32>) -> vec3<f32> {
    let dims = vec3<f32>(textureDimensions(lut_texture));
    let size = dims - vec3<f32>(1.0);
    let scaled = clamp(uv, vec3<f32>(0.0), vec3<f32>(1.0)) * size;
    let i_base = floor(scaled);
    let f = scaled - i_base;
    let coord0 = vec3<i32>(i_base);
    let coord1 = min(coord0 + vec3<i32>(1), vec3<i32>(dims) - vec3<i32>(1));
    let c000 = textureLoad(lut_texture, coord0, 0).rgb;
    let c111 = textureLoad(lut_texture, coord1, 0).rgb;

    var res = vec3<f32>(0.0);

    if (f.r > f.g) {
        if (f.g > f.b) {
            let c100 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord0.z), 0).rgb;
            let c110 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord1.y, coord0.z), 0).rgb;

            res = c000 * (1.0 - f.r) +
                  c100 * (f.r - f.g) +
                  c110 * (f.g - f.b) +
                  c111 * (f.b);
        } else if (f.r > f.b) {
            let c100 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord0.z), 0).rgb;
            let c101 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.r) +
                  c100 * (f.r - f.b) +
                  c101 * (f.b - f.g) +
                  c111 * (f.g);
        } else {
            let c001 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord0.y, coord1.z), 0).rgb;
            let c101 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.b) +
                  c001 * (f.b - f.r) +
                  c101 * (f.r - f.g) +
                  c111 * (f.g);
        }
    } else {
        if (f.b > f.g) {
            let c001 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord0.y, coord1.z), 0).rgb;
            let c011 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.b) +
                  c001 * (f.b - f.g) +
                  c011 * (f.g - f.r) +
                  c111 * (f.r);
        } else if (f.b > f.r) {
            let c010 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord0.z), 0).rgb;
            let c011 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.g) +
                  c010 * (f.g - f.b) +
                  c011 * (f.b - f.r) +
                  c111 * (f.r);
        } else {
            let c010 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord0.z), 0).rgb;
            let c110 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord1.y, coord0.z), 0).rgb;

            res = c000 * (1.0 - f.g) +
                  c010 * (f.g - f.r) +
                  c110 * (f.r - f.b) +
                  c111 * (f.b);
        }
    }

    return res;
}

// A hue (degrees) with a strength as a 2D vector, so colours can be averaged around the hue circle.
fn hue_vector(hue: f32, strength: f32) -> vec2<f32> {
    let angle = radians(hue);
    return vec2<f32>(cos(angle), sin(angle)) * strength;
}

// The hue (0–360 degrees) a `hue_vector` sum points to.
fn vector_hue(v: vec2<f32>) -> f32 {
    let hue = degrees(atan2(v.y, v.x));
    return select(hue, hue + 360.0, hue < 0.0);
}

// Rotates a colour's hue by `shift` degrees at the same saturation and luminance,
// so a tint keeps its strength whatever hue it is turned to.
fn rotate_hue(color: vec3<f32>, shift: f32) -> vec3<f32> {
    if (shift == 0.0) { return color; }
    let hsv = rgb_to_hsv(color);
    var h = (hsv.x + shift) % 360.0;
    if (h < 0.0) { h += 360.0; }
    let rotated = hsv_to_rgb(vec3<f32>(h, hsv.y, hsv.z));
    return rotated * (get_luma(color) / max(get_luma(rotated), 0.0001));
}

fn apply_glow_bloom(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    amount: f32,
    is_raw: u32,
    exp: f32, bright: f32, con: f32, wh: f32,
    glow_hue: f32, glow_saturation: f32
) -> vec3<f32> {
    if (amount <= 0.0) {
        return color;
    }

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    blurred_linear = apply_linear_exposure(blurred_linear, exp);
    blurred_linear = apply_filmic_exposure(blurred_linear, bright);
    blurred_linear = apply_tonal_adjustments(blurred_linear, blurred_color_input_space, is_raw, 0.0, 0.0, wh, 0.0);

    let linear_luma = get_luma(max(blurred_linear, vec3<f32>(0.0)));

    var perceptual_luma: f32;
    if (linear_luma <= 1.0) {
        perceptual_luma = pow(max(linear_luma, 0.0), 1.0 / 2.2);
    } else {
        perceptual_luma = 1.0 + pow(linear_luma - 1.0, 1.0 / 2.2);
    }

    let luma_cutoff = mix(0.75, 0.08, clamp(amount, 0.0, 1.0));

    let cutoff_fade = smoothstep(
        luma_cutoff,
        luma_cutoff + 0.15,
        perceptual_luma
    );

    let excess = max(perceptual_luma - luma_cutoff, 0.0);

    let falloff_range = 5.5;
    let normalized = excess / falloff_range;

    let bloom_intensity =
        pow(smoothstep(0.0, 1.0, normalized), 0.45);

    var bloom_color: vec3<f32>;
    if (linear_luma > 0.01) {
        let color_ratio = blurred_linear / linear_luma;
        let warm_tint = vec3<f32>(1.03, 1.0, 0.97);
        bloom_color = color_ratio * warm_tint;
    } else {
        bloom_color = vec3<f32>(1.0, 0.99, 0.98);
    }
    // Colour: move the glow toward the chosen hue at the same brightness.
    if (glow_saturation > 0.0) {
        let target_rgb = hsv_to_rgb(vec3<f32>(glow_hue % 360.0, 1.0, 1.0));
        let target_color = target_rgb / max(get_luma(target_rgb), 0.0001) * get_luma(max(bloom_color, vec3<f32>(0.0)));
        bloom_color = mix(bloom_color, target_color, clamp(glow_saturation, 0.0, 1.0));
    }

    let luma_factor = pow(linear_luma, 0.6);

    let black_gate_width = 0.5;
    let black_gate_raw = smoothstep(0.0, black_gate_width, linear_luma);
    let black_gate = pow(black_gate_raw, 0.5);

    bloom_color *= bloom_intensity * luma_factor * cutoff_fade * black_gate;

    let current_luma = get_luma(max(color, vec3<f32>(0.0)));
    let protection = 1.0 - smoothstep(1.0, 2.2, current_luma);

    return color + bloom_color * amount * 3.8 * protection;
}

fn apply_halation(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    amount: f32,
    is_raw: u32,
    exp: f32, bright: f32, con: f32, wh: f32,
    hue_shift: f32
) -> vec3<f32> {
    if (amount <= 0.0) { return color; }

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    blurred_linear = apply_linear_exposure(blurred_linear, exp);
    blurred_linear = apply_filmic_exposure(blurred_linear, bright);
    blurred_linear = apply_tonal_adjustments(blurred_linear, blurred_color_input_space, is_raw, 0.0, 0.0, wh, 0.0);

    let linear_luma = get_luma(max(blurred_linear, vec3<f32>(0.0)));

    var perceptual_luma: f32;
    if (linear_luma <= 1.0) {
        perceptual_luma = pow(max(linear_luma, 0.0), 1.0 / 2.2);
    } else {
        perceptual_luma = 1.0 + pow(linear_luma - 1.0, 1.0 / 2.2);
    }

    let luma_cutoff = mix(0.85, 0.1, clamp(amount, 0.0, 1.0));

    if (perceptual_luma <= luma_cutoff) { return color; }

    let excess = perceptual_luma - luma_cutoff;
    let range = max(1.5 - luma_cutoff, 0.1);
    let halation_mask = smoothstep(0.0, range * 0.6, excess);

    let halation_core = rotate_hue(vec3<f32>(1.0, 0.15, 0.03), hue_shift);
    let halation_fringe = rotate_hue(vec3<f32>(1.0, 0.32, 0.10), hue_shift);

    let intensity_blend = smoothstep(0.0, 0.7, halation_mask);
    let halation_tint = mix(halation_fringe, halation_core, intensity_blend);

    let glow_intensity = halation_mask * linear_luma;
    let halation_glow = halation_tint * glow_intensity;

    let color_luma = get_luma(max(color, vec3<f32>(0.0)));
    let desat_strength = halation_mask * 0.12;
    let affected_color = mix(color, vec3<f32>(color_luma), desat_strength);

    let contrast_reduced = mix(vec3<f32>(0.5), affected_color, 1.0 - halation_mask * 0.06);

    return contrast_reduced + halation_glow * amount * 2.5;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let out_dims = vec2<u32>(textureDimensions(output_texture));
    if (id.x >= out_dims.x || id.y >= out_dims.y) { return; }

    const REFERENCE_DIMENSION: f32 = 1080.0;
    let full_dims = vec2<f32>(textureDimensions(input_texture));
    let current_ref_dim = min(full_dims.x, full_dims.y);
    let scale = max(0.1, current_ref_dim / REFERENCE_DIMENSION);

    let absolute_coord = id.xy + vec2<u32>(adjustments.tile_offset_x, adjustments.tile_offset_y);
    let absolute_coord_i = vec2<i32>(absolute_coord);

    let ca_rc = adjustments.global.chromatic_aberration_red_cyan;
    let ca_by = adjustments.global.chromatic_aberration_blue_yellow;
    var color_from_texture = textureLoad(input_texture, absolute_coord, 0).rgb;
    if (abs(ca_rc) > 0.000001 || abs(ca_by) > 0.000001) {
        color_from_texture = apply_ca_correction(absolute_coord, ca_rc, ca_by);
    }
    let original_alpha = textureLoad(input_texture, absolute_coord, 0).a;

    var initial_linear_rgb: vec3<f32>;
    let is_raw = adjustments.global.is_raw_image;
    if (is_raw == 0u) {
        initial_linear_rgb = srgb_to_linear(color_from_texture);
    } else {
        initial_linear_rgb = color_from_texture;
    }
    let blend_backdrop_rgb = select(
        linear_to_srgb_extended(initial_linear_rgb),
        clamp(color_from_texture, vec3<f32>(0.0), vec3<f32>(1.0)),
        is_raw == 0u
    );

    var t_exposure = adjustments.global.exposure;
    var t_brightness = adjustments.global.brightness;
    var t_contrast = adjustments.global.contrast;
    var t_highlights = adjustments.global.highlights;
    var t_shadows = adjustments.global.shadows;
    var t_whites = adjustments.global.whites;
    var t_blacks = adjustments.global.blacks;
    var t_saturation = adjustments.global.saturation;
    var t_temperature = adjustments.global.temperature;
    var t_tint = adjustments.global.tint;
    var t_vibrance = adjustments.global.vibrance;
    var t_luma_nr = adjustments.global.luma_noise_reduction;
    var t_color_nr = adjustments.global.color_noise_reduction;
    var t_clarity = adjustments.global.clarity;
    var t_dehaze = adjustments.global.dehaze;
    var t_structure = adjustments.global.structure;
    var t_glow = adjustments.global.glow_amount;
    var t_halation = adjustments.global.halation_amount;
    // Glow and halation colours, weighted by each contribution's amount. They are used only
    // when a mask brings a colour of its own, so the photo's colour alone renders unchanged.
    var glow_tint = hue_vector(adjustments.global.glow_hue, adjustments.global.glow_saturation) * max(t_glow, 0.0);
    var halation_tint = hue_vector(adjustments.global.halation_hue_shift, 1.0) * max(t_halation, 0.0);
    var glow_colour_mixed = false;
    var halation_colour_mixed = false;
    var t_flare = adjustments.global.flare_amount;
    var t_sharpness = adjustments.global.sharpness;
    var t_hue = adjustments.global.hue;

    var h0_h = adjustments.global.hsl[0].hue; var h0_s = adjustments.global.hsl[0].saturation; var h0_l = adjustments.global.hsl[0].luminance;
    var h1_h = adjustments.global.hsl[1].hue; var h1_s = adjustments.global.hsl[1].saturation; var h1_l = adjustments.global.hsl[1].luminance;
    var h2_h = adjustments.global.hsl[2].hue; var h2_s = adjustments.global.hsl[2].saturation; var h2_l = adjustments.global.hsl[2].luminance;
    var h3_h = adjustments.global.hsl[3].hue; var h3_s = adjustments.global.hsl[3].saturation; var h3_l = adjustments.global.hsl[3].luminance;
    var h4_h = adjustments.global.hsl[4].hue; var h4_s = adjustments.global.hsl[4].saturation; var h4_l = adjustments.global.hsl[4].luminance;
    var h5_h = adjustments.global.hsl[5].hue; var h5_s = adjustments.global.hsl[5].saturation; var h5_l = adjustments.global.hsl[5].luminance;
    var h6_h = adjustments.global.hsl[6].hue; var h6_s = adjustments.global.hsl[6].saturation; var h6_l = adjustments.global.hsl[6].luminance;
    var h7_h = adjustments.global.hsl[7].hue; var h7_s = adjustments.global.hsl[7].saturation; var h7_l = adjustments.global.hsl[7].luminance;

    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];

            t_exposure += m.exposure * influence;
            t_brightness += m.brightness * influence;
            t_contrast += m.contrast * influence;
            t_highlights += m.highlights * influence;
            t_shadows += m.shadows * influence;
            t_whites += m.whites * influence;
            t_blacks += m.blacks * influence;

            t_saturation += m.saturation * influence;
            t_temperature += m.temperature * influence;
            t_tint += m.tint * influence;
            t_vibrance += m.vibrance * influence;

            t_luma_nr += m.luma_noise_reduction * influence;
            t_color_nr += m.color_noise_reduction * influence;
            t_clarity += m.clarity * influence;
            t_dehaze += m.dehaze * influence;
            t_structure += m.structure * influence;

            let glow_weight = m.glow_amount * influence;
            t_glow += glow_weight;
            if (glow_weight > 0.0) {
                glow_tint += hue_vector(m.glow_hue, m.glow_saturation) * glow_weight;
                glow_colour_mixed = glow_colour_mixed
                    || m.glow_hue != adjustments.global.glow_hue
                    || m.glow_saturation != adjustments.global.glow_saturation;
            }
            let halation_weight = m.halation_amount * influence;
            t_halation += halation_weight;
            if (halation_weight > 0.0) {
                halation_tint += hue_vector(m.halation_hue_shift, 1.0) * halation_weight;
                halation_colour_mixed = halation_colour_mixed
                    || m.halation_hue_shift != adjustments.global.halation_hue_shift;
            }
            t_flare += m.flare_amount * influence;
            t_hue += m.hue * influence;

            h0_h += m.hsl[0].hue * influence; h0_s += m.hsl[0].saturation * influence; h0_l += m.hsl[0].luminance * influence;
            h1_h += m.hsl[1].hue * influence; h1_s += m.hsl[1].saturation * influence; h1_l += m.hsl[1].luminance * influence;
            h2_h += m.hsl[2].hue * influence; h2_s += m.hsl[2].saturation * influence; h2_l += m.hsl[2].luminance * influence;
            h3_h += m.hsl[3].hue * influence; h3_s += m.hsl[3].saturation * influence; h3_l += m.hsl[3].luminance * influence;
            h4_h += m.hsl[4].hue * influence; h4_s += m.hsl[4].saturation * influence; h4_l += m.hsl[4].luminance * influence;
            h5_h += m.hsl[5].hue * influence; h5_s += m.hsl[5].saturation * influence; h5_l += m.hsl[5].luminance * influence;
            h6_h += m.hsl[6].hue * influence; h6_s += m.hsl[6].saturation * influence; h6_l += m.hsl[6].luminance * influence;
            h7_h += m.hsl[7].hue * influence; h7_s += m.hsl[7].saturation * influence; h7_l += m.hsl[7].luminance * influence;
        }
    }

    let final_hsl = array<HslColor, 8>(
        HslColor(h0_h, h0_s, h0_l, 0.0), HslColor(h1_h, h1_s, h1_l, 0.0),
        HslColor(h2_h, h2_s, h2_l, 0.0), HslColor(h3_h, h3_s, h3_l, 0.0),
        HslColor(h4_h, h4_s, h4_l, 0.0), HslColor(h5_h, h5_s, h5_l, 0.0),
        HslColor(h6_h, h6_s, h6_l, 0.0), HslColor(h7_h, h7_s, h7_l, 0.0)
    );

    initial_linear_rgb = apply_noise_reduction(
        initial_linear_rgb, absolute_coord_i,
        t_luma_nr, t_color_nr, scale, is_raw
    );

    let sharpness_blurred = textureLoad(sharpness_blur_texture, absolute_coord, 0).rgb;
    let tonal_blurred = textureLoad(tonal_blur_texture, absolute_coord, 0).rgb;
    let clarity_blurred = textureLoad(clarity_blur_texture, absolute_coord, 0).rgb;
    let structure_blurred = textureLoad(structure_blur_texture, absolute_coord, 0).rgb;

    // Gaussian Blur mixes toward the structure blur: first the whole photo's, then each mask's.
    let structure_blurred_linear = select(
        structure_blurred,
        srgb_to_linear(structure_blurred),
        is_raw == 0u
    );
    let global_blur_amount = adjustments.global.gaussian_blur_amount;
    if (global_blur_amount > 0.001) {
        initial_linear_rgb = mix(initial_linear_rgb, structure_blurred_linear, clamp(global_blur_amount, 0.0, 1.0));
    }
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        let blur_amount = adjustments.mask_adjustments[i].gaussian_blur_amount * influence;
        if (blur_amount > 0.001) {
            initial_linear_rgb = mix(initial_linear_rgb, structure_blurred_linear, clamp(blur_amount, 0.0, 1.0));
        }
    }

    var locally_contrasted_rgb = initial_linear_rgb;

    locally_contrasted_rgb = apply_local_contrast(
        locally_contrasted_rgb, sharpness_blurred,
        t_sharpness, is_raw, 0u, adjustments.global.sharpness_threshold
    );

    var sharpness_delta = vec3<f32>(0.0);
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            if (abs(m.sharpness) > 0.001) {
                let local_sharp_result = apply_local_contrast(
                    initial_linear_rgb, sharpness_blurred,
                    m.sharpness, is_raw, 0u, m.sharpness_threshold
                );
                sharpness_delta += (local_sharp_result - initial_linear_rgb) * influence;
            }
        }
    }
    locally_contrasted_rgb += sharpness_delta;

    locally_contrasted_rgb = apply_local_contrast(locally_contrasted_rgb, clarity_blurred, t_clarity, is_raw, 1u, 0.0);
    locally_contrasted_rgb = apply_local_contrast(locally_contrasted_rgb, structure_blurred, t_structure, is_raw, 1u, 0.0);
    locally_contrasted_rgb = apply_centre_local_contrast(locally_contrasted_rgb, adjustments.global.centre, absolute_coord_i, clarity_blurred, is_raw);

    var processed_rgb = apply_linear_exposure(locally_contrasted_rgb, t_exposure);

    if (t_glow > 0.0) {
        var glow_hue = adjustments.global.glow_hue;
        var glow_saturation = adjustments.global.glow_saturation;
        if (glow_colour_mixed) {
            glow_hue = vector_hue(glow_tint);
            glow_saturation = length(glow_tint) / t_glow;
        }
        processed_rgb = apply_glow_bloom(
            processed_rgb, structure_blurred, t_glow, is_raw,
            t_exposure, t_brightness, t_contrast, t_whites,
            glow_hue, glow_saturation
        );
    }
    if (t_halation > 0.0) {
        let halation_hue_shift = select(
            adjustments.global.halation_hue_shift, vector_hue(halation_tint), halation_colour_mixed
        );
        processed_rgb = apply_halation(
            processed_rgb, clarity_blurred, t_halation, is_raw,
            t_exposure, t_brightness, t_contrast, t_whites,
            halation_hue_shift
        );
    }
    if (t_flare > 0.0) {
        let uv = vec2<f32>(absolute_coord) / full_dims;
        var flare_color = textureSampleLevel(flare_texture, linear_sampler, uv, 0.0).rgb;
        flare_color *= 1.4;
        flare_color = flare_color * flare_color;
        let linear_luma = get_luma(max(processed_rgb, vec3<f32>(0.0)));
        var perceptual_luma: f32;
        if (linear_luma <= 1.0) {
            perceptual_luma = pow(max(linear_luma, 0.0), 1.0 / 2.2);
        } else {
            perceptual_luma = 1.0 + pow(linear_luma - 1.0, 1.0 / 2.2);
        }
        let protection = 1.0 - smoothstep(0.7, 1.8, perceptual_luma);
        processed_rgb += flare_color * t_flare * protection;
    }

    var composite_rgb_linear = apply_dehaze(processed_rgb, structure_blurred, is_raw, t_dehaze);
    composite_rgb_linear = apply_centre_tonal_and_color(composite_rgb_linear, adjustments.global.centre, absolute_coord_i);
    composite_rgb_linear = apply_white_balance(composite_rgb_linear, t_temperature, t_tint);
    composite_rgb_linear = apply_filmic_exposure(composite_rgb_linear, t_brightness);
    composite_rgb_linear = apply_tonal_adjustments(composite_rgb_linear, tonal_blurred, is_raw, t_contrast, t_shadows, t_whites, t_blacks);
    composite_rgb_linear = apply_highlights_adjustment(composite_rgb_linear, tonal_blurred, is_raw, t_highlights);
    composite_rgb_linear = apply_color_calibration(composite_rgb_linear, adjustments.global.color_calibration);
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let calibrated = apply_color_calibration(
                composite_rgb_linear,
                adjustments.mask_adjustments[i].color_calibration
            );
            composite_rgb_linear = mix(composite_rgb_linear, calibrated, influence);
        }
    }
    if (SAMPLE_PROBE == SAMPLE_PROBE_HSL) {
        textureStore(output_texture, id.xy, hsl_probe(composite_rgb_linear));
        return;
    }
    composite_rgb_linear = apply_hsl_panel(composite_rgb_linear, final_hsl, absolute_coord_i);
    let point_coords = point_color_coords(composite_rgb_linear);
    if (SAMPLE_PROBE == SAMPLE_PROBE_POINT_COLOR) {
        textureStore(output_texture, id.xy, vec4<f32>(point_coords.x / 360.0, point_coords.y, point_coords.z, 1.0));
        return;
    }
    composite_rgb_linear = apply_point_colors(composite_rgb_linear, point_coords);
    // Visualize Range: the shown Point Color's range keeps its colour, the rest turns grey.
    var point_color_visualized = 1.0;
    if (adjustments.global.point_color_visualize > 0u) {
        point_color_visualized = point_color_weight(
            adjustments.global.point_colors[adjustments.global.point_color_visualize - 1u], point_coords);
    }
    composite_rgb_linear = apply_hue_shift(composite_rgb_linear, t_hue);
    composite_rgb_linear = apply_creative_color(composite_rgb_linear, t_saturation, t_vibrance);

    composite_rgb_linear = apply_color_grading(
        composite_rgb_linear,
        adjustments.global.color_grading_shadows,
        adjustments.global.color_grading_midtones,
        adjustments.global.color_grading_highlights,
        adjustments.global.color_grading_global,
        adjustments.global.color_grading_blending,
        adjustments.global.color_grading_balance
    );

    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            let mask_graded = apply_color_grading(
                composite_rgb_linear,
                m.color_grading_shadows, m.color_grading_midtones, m.color_grading_highlights, m.color_grading_global, m.color_grading_blending, m.color_grading_balance
            );
            composite_rgb_linear = mix(composite_rgb_linear, mask_graded, influence);
        }
    }

    composite_rgb_linear = apply_vignette_effect(
        composite_rgb_linear,
        adjustments.global.vignette_amount,
        adjustments.global.vignette_midpoint,
        adjustments.global.vignette_roundness,
        adjustments.global.vignette_feather,
        absolute_coord
    );
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            let vignetted = apply_vignette_effect(
                composite_rgb_linear,
                m.vignette_amount,
                m.vignette_midpoint,
                m.vignette_roundness,
                m.vignette_feather,
                absolute_coord
            );
            composite_rgb_linear = mix(composite_rgb_linear, vignetted, influence);
        }
    }

    var base_srgb: vec3<f32>;
    if (adjustments.global.tonemapper_mode == TONE_MAPPER_MODE_AGX) {
        base_srgb = agx_full_transform(composite_rgb_linear);
    } else if (adjustments.global.tonemapper_mode == TONE_MAPPER_MODE_NATURAL) {
        // Non-RAW images already carry a display tone curve, so Natural
        // renders them like Basic.
        if (is_raw == 1u) {
            let compensated = composite_rgb_linear * exp2(adjustments.global.natural_exposure_ev);
            base_srgb = linear_to_srgb(natural_tonemap(compensated));
        } else {
            base_srgb = linear_to_srgb(composite_rgb_linear);
        }
    } else if (is_raw == 1u) {
        var srgb_emulated = linear_to_srgb(composite_rgb_linear);
        const BRIGHTNESS_GAMMA: f32 = 1.1;
        srgb_emulated = pow(srgb_emulated, vec3<f32>(1.0 / BRIGHTNESS_GAMMA));
        const CONTRAST_MIX: f32 = 0.75;
        let contrast_curve = srgb_emulated * srgb_emulated * (3.0 - 2.0 * srgb_emulated);
        base_srgb = mix(srgb_emulated, contrast_curve, CONTRAST_MIX);
    } else {
        base_srgb = linear_to_srgb(composite_rgb_linear);
    }

    if (SAMPLE_PROBE == SAMPLE_PROBE_CURVE) {
        textureStore(output_texture, id.xy, curve_probe(base_srgb));
        return;
    }
    var final_rgb = apply_all_curves(base_srgb,
        adjustments.global.luma_curve, adjustments.global.luma_curve_count,
        adjustments.global.red_curve, adjustments.global.red_curve_count,
        adjustments.global.green_curve, adjustments.global.green_curve_count,
        adjustments.global.blue_curve, adjustments.global.blue_curve_count
    );
    if (SAMPLE_PROBE == SAMPLE_PROBE_MASK_CURVE) {
        textureStore(output_texture, id.xy, curve_probe(final_rgb));
        return;
    }

    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            let mask_curved_srgb = apply_all_curves(final_rgb,
                m.luma_curve, m.luma_curve_count,
                m.red_curve, m.red_curve_count,
                m.green_curve, m.green_curve_count,
                m.blue_curve, m.blue_curve_count
            );
            final_rgb = mix(final_rgb, mask_curved_srgb, influence);
        }
    }

    if (adjustments.global.has_lut == 1u) {
        let lut_color = sample_lut_tetrahedral(final_rgb);
        final_rgb = mix(final_rgb, lut_color, adjustments.global.lut_intensity);
    }

    if (adjustments.global.monochrome == 1u) {
        final_rgb = monochrome_srgb(final_rgb);
    }
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001 && adjustments.mask_adjustments[i].monochrome == 1u) {
            final_rgb = mix(final_rgb, monochrome_srgb(final_rgb), influence);
        }
    }
    // After every tonal step and the Black & White conversion, before grain, so the zones
    // follow the tones on screen and grain stays neutral.
    if (adjustments.global.zone_tint.enabled == 1u) {
        final_rgb = apply_zone_tint(final_rgb, adjustments.global.zone_tint);
    }

    final_rgb += grain_delta(
        final_rgb,
        absolute_coord_i,
        adjustments.global.grain_amount,
        adjustments.global.grain_size,
        adjustments.global.grain_roughness,
        scale
    );
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            final_rgb += grain_delta(
                final_rgb,
                absolute_coord_i,
                m.grain_amount,
                m.grain_size,
                m.grain_roughness,
                scale
            ) * influence;
        }
    }

    // Normal retains the established local-adjustment rendering. Other modes
    // composite that adjusted result against the input in mask-list order.
    // A Black & White image blends against a monochrome input so the
    // backdrop cannot reintroduce color; it carries the Zone Tint so the blend keeps it.
    var backdrop_rgb = blend_backdrop_rgb;
    var backdrop_ready = adjustments.global.monochrome == 0u;
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let mode = adjustments.mask_adjustments[i].blend_mode;
        if (mode != 0u) {
            let influence = get_mask_influence(i, absolute_coord);
            if (influence > 0.001) {
                if (!backdrop_ready) {
                    backdrop_rgb = monochrome_srgb(backdrop_rgb);
                    if (adjustments.global.zone_tint.enabled == 1u) {
                        backdrop_rgb = apply_zone_tint(backdrop_rgb, adjustments.global.zone_tint);
                    }
                    backdrop_ready = true;
                }
                let blended = blend_colors(backdrop_rgb, final_rgb, mode);
                final_rgb = mix(final_rgb, blended, influence);
            }
        }
    }

    if (adjustments.global.point_color_visualize > 0u) {
        final_rgb = mix(vec3<f32>(get_luma(final_rgb)), final_rgb, point_color_visualized);
    }

    if (adjustments.global.show_clipping == 1u) {
        let HIGHLIGHT_WARNING_COLOR = vec3<f32>(1.0, 0.0, 0.0);
        let SHADOW_WARNING_COLOR = vec3<f32>(0.0, 0.0, 1.0);
        let HIGHLIGHT_CLIP_THRESHOLD = 0.998;
        let SHADOW_CLIP_THRESHOLD = 0.002;
        if (any(final_rgb > vec3<f32>(HIGHLIGHT_CLIP_THRESHOLD))) {
            final_rgb = HIGHLIGHT_WARNING_COLOR;
        } else if (any(final_rgb < vec3<f32>(SHADOW_CLIP_THRESHOLD))) {
            final_rgb = SHADOW_WARNING_COLOR;
        }
    }

    if (HIGH_PRECISION_OUTPUT == 0u) {
        let dither_amount = 1.0 / 255.0;
        final_rgb += dither(id.xy) * dither_amount;
    }

    textureStore(output_texture, id.xy, vec4<f32>(clamp(final_rgb, vec3<f32>(0.0), vec3<f32>(1.0)), original_alpha));
}
