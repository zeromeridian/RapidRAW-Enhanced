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

struct GlobalAdjustments {
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,
    
    sharpness: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,
    vignette_amount: f32,
    vignette_midpoint: f32,
    vignette_roundness: f32,
    vignette_feather: f32,
    grain_amount: f32,
    grain_size: f32,
    grain_roughness: f32,
    _pad1: f32,

    hsl: array<HslColor, 8>,
    luma_curve: array<Point, 16>,
    red_curve: array<Point, 16>,
    green_curve: array<Point, 16>,
    blue_curve: array<Point, 16>,
    luma_curve_count: u32,
    red_curve_count: u32,
    green_curve_count: u32,
    blue_curve_count: u32,
}

struct MaskAdjustments {
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,
    
    sharpness: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,
    
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
    _pad4: f32,

    hsl: array<HslColor, 8>,
    luma_curve: array<Point, 16>,
    red_curve: array<Point, 16>,
    green_curve: array<Point, 16>,
    blue_curve: array<Point, 16>,
    luma_curve_count: u32,
    red_curve_count: u32,
    green_curve_count: u32,
    blue_curve_count: u32,
}

struct AllAdjustments {
    global: GlobalAdjustments,
    mask_adjustments: array<MaskAdjustments, 16>,
    mask_count: u32,
    tile_offset_x: u32,
    tile_offset_y: u32,
    _pad1: u32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> adjustments: AllAdjustments;
@group(0) @binding(3) var mask_textures: texture_2d_array<f32>;

const LUMA_COEFF = vec3<f32>(0.2126, 0.7152, 0.0722);

fn get_luma(c: vec3<f32>) -> f32 {
    return dot(c, LUMA_COEFF);
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

fn get_hsl_influence(hue: f32, center_hue: f32, range_width: f32) -> f32 {
    let diff1 = abs(hue - center_hue);
    let diff2 = 360.0 - diff1;
    let distance = min(diff1, diff2);
    let normalized_distance = distance / (range_width * 0.5);
    return 1.0 - smoothstep(0.0, 1.0, normalized_distance);
}

fn rand(co: vec2<f32>) -> f32 {
    return fract(sin(dot(co.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn interpolate_curve_segment(x: f32, p1: Point, p2: Point) -> f32 {
    var result_y: f32;
    if (abs(p1.x - p2.x) < 0.001) {
        result_y = p1.y;
    } else {
        let t = (x - p1.x) / (p2.x - p1.x);
        result_y = mix(p1.y, p2.y, t);
    }
    return clamp(result_y / 255.0, 0.0, 1.0);
}

fn apply_curve(val: f32, points: array<Point, 16>, count: u32) -> f32 {
    if (count < 2u) { return val; }
    let x = val * 255.0;
    if (x <= points[0].x) { return clamp(points[0].y / 255.0, 0.0, 1.0); }
    if (count >= 2u && x <= points[1].x) { return interpolate_curve_segment(x, points[0], points[1]); }
    if (count >= 3u && x <= points[2].x) { return interpolate_curve_segment(x, points[1], points[2]); }
    if (count >= 4u && x <= points[3].x) { return interpolate_curve_segment(x, points[2], points[3]); }
    if (count >= 5u && x <= points[4].x) { return interpolate_curve_segment(x, points[3], points[4]); }
    if (count >= 6u && x <= points[5].x) { return interpolate_curve_segment(x, points[4], points[5]); }
    if (count >= 7u && x <= points[6].x) { return interpolate_curve_segment(x, points[5], points[6]); }
    if (count >= 8u && x <= points[7].x) { return interpolate_curve_segment(x, points[6], points[7]); }
    if (count >= 9u && x <= points[8].x) { return interpolate_curve_segment(x, points[7], points[8]); }
    if (count >= 10u && x <= points[9].x) { return interpolate_curve_segment(x, points[8], points[9]); }
    if (count >= 11u && x <= points[10].x) { return interpolate_curve_segment(x, points[9], points[10]); }
    if (count >= 12u && x <= points[11].x) { return interpolate_curve_segment(x, points[10], points[11]); }
    if (count >= 13u && x <= points[12].x) { return interpolate_curve_segment(x, points[11], points[12]); }
    if (count >= 14u && x <= points[13].x) { return interpolate_curve_segment(x, points[12], points[13]); }
    if (count >= 15u && x <= points[14].x) { return interpolate_curve_segment(x, points[13], points[14]); }
    if (count >= 16u && x <= points[15].x) { return interpolate_curve_segment(x, points[14], points[15]); }
    if (count >= 16u) { return clamp(points[15].y / 255.0, 0.0, 1.0); }
    if (count >= 15u) { return clamp(points[14].y / 255.0, 0.0, 1.0); }
    if (count >= 14u) { return clamp(points[13].y / 255.0, 0.0, 1.0); }
    if (count >= 13u) { return clamp(points[12].y / 255.0, 0.0, 1.0); }
    if (count >= 12u) { return clamp(points[11].y / 255.0, 0.0, 1.0); }
    if (count >= 11u) { return clamp(points[10].y / 255.0, 0.0, 1.0); }
    if (count >= 10u) { return clamp(points[9].y / 255.0, 0.0, 1.0); }
    if (count >= 9u) { return clamp(points[8].y / 255.0, 0.0, 1.0); }
    if (count >= 8u) { return clamp(points[7].y / 255.0, 0.0, 1.0); }
    if (count >= 7u) { return clamp(points[6].y / 255.0, 0.0, 1.0); }
    if (count >= 6u) { return clamp(points[5].y / 255.0, 0.0, 1.0); }
    if (count >= 5u) { return clamp(points[4].y / 255.0, 0.0, 1.0); }
    if (count >= 4u) { return clamp(points[3].y / 255.0, 0.0, 1.0); }
    if (count >= 3u) { return clamp(points[2].y / 255.0, 0.0, 1.0); }
    return clamp(points[1].y / 255.0, 0.0, 1.0);
}

fn apply_tonal_adjustments(color: vec3<f32>, exp: f32, con: f32, hi: f32, sh: f32, wh: f32, bl: f32) -> vec3<f32> {
    var rgb = color * pow(2.0, exp);

    let black_point = bl * 0.5;
    let white_point = 1.0 - wh * 0.5;
    rgb = (rgb - black_point) / max(white_point - black_point, 0.001);
    
    let original_luma = get_luma(rgb);
    if (original_luma > 0.001) {
        let shadow_curve = smoothstep(0.0, 0.5, original_luma);
        let highlight_compress = -hi * shadow_curve; // Inverted highlights
        let luma_adjust = -highlight_compress;
        let adjusted_luma = original_luma + luma_adjust;
        rgb *= (adjusted_luma / original_luma);
    }

    // Reverted shadow logic to original additive method
    let luma = get_luma(rgb);
    let shadow_mix = 1.0 - smoothstep(0.0, 0.5, luma);
    rgb += sh * shadow_mix;

    rgb = 0.5 + (rgb - 0.5) * (1.0 + con);
    return clamp(rgb, vec3<f32>(-0.1), vec3<f32>(1.5));
}

fn apply_color_adjustments(color: vec3<f32>, sat: f32, temp: f32, tnt: f32, vib: f32) -> vec3<f32> {
    var rgb = color;
    let temp_kelvin_mult = vec3<f32>(1.0 + temp * 0.2, 1.0, 1.0 - temp * 0.2);
    let tint_mult = vec3<f32>(1.0 - tnt * 0.1, 1.0 + tnt * 0.1, 1.0 - tnt * 0.1);
    rgb *= temp_kelvin_mult * tint_mult;
    let luma = get_luma(rgb);
    var sat_rgb = mix(vec3<f32>(luma), rgb, 1.0 + sat);
    if (vib != 0.0) {
        let original_sat = length(rgb - luma);
        let vibrance_mask = 1.0 - smoothstep(0.2, 0.6, original_sat);
        let vibrance_amount = vib * vibrance_mask;
        sat_rgb = mix(sat_rgb, mix(vec3<f32>(get_luma(sat_rgb)), sat_rgb, 1.0 + vibrance_amount), abs(vibrance_amount));
    }
    return sat_rgb;
}

fn apply_local_contrast(processed_color: vec3<f32>, coords_i: vec2<i32>, radius: i32, amount: f32) -> vec3<f32> {
    if (amount == 0.0) { return processed_color; }
    let max_coords = vec2<i32>(textureDimensions(input_texture) - 1u);
    let original_luma = get_luma(processed_color);
    var blurred_linear = vec3<f32>(0.0);
    var total_weight = 0.0;
    let spatial_sigma = f32(radius);
    let range_sigma = 0.25;
    for (var y = -radius; y <= radius; y += 1) {
        for (var x = -radius; x <= radius; x += 1) {
            let offset = vec2<i32>(x, y);
            let sample_coords = clamp(coords_i + offset, vec2<i32>(0), max_coords);
            let sample_linear = srgb_to_linear(textureLoad(input_texture, sample_coords, 0).rgb);
            let sample_luma = get_luma(sample_linear);
            let spatial_dist_sq = f32(x * x + y * y);
            let luma_dist = sample_luma - original_luma;
            let spatial_weight = exp(-spatial_dist_sq / (2.0 * spatial_sigma * spatial_sigma));
            let range_weight = exp(-(luma_dist * luma_dist) / (2.0 * range_sigma * range_sigma));
            let weight = spatial_weight * range_weight;
            blurred_linear += sample_linear * weight;
            total_weight += weight;
        }
    }
    if (total_weight > 0.0) { blurred_linear /= total_weight; } else { blurred_linear = processed_color; }
    let detail_linear = processed_color - blurred_linear;
    let shadow_protection = smoothstep(0.0, 0.25, original_luma);
    let highlight_protection = 1.0 - smoothstep(0.75, 1.0, original_luma);
    let midtone_mask = shadow_protection * highlight_protection;
    let enhanced_detail = detail_linear * amount * midtone_mask;
    return processed_color + enhanced_detail;
}

fn get_dark_channel_at(coord: vec2<i32>, max_coords: vec2<i32>, atmospheric_light: vec3<f32>) -> f32 {
    var local_min = 1.0;
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let sample_coords = clamp(coord + vec2<i32>(x, y), vec2<i32>(0), max_coords);
            let sample_linear = srgb_to_linear(textureLoad(input_texture, sample_coords, 0).rgb);
            let normalized = sample_linear / atmospheric_light;
            local_min = min(local_min, min(normalized.r, min(normalized.g, normalized.b)));
        }
    }
    return local_min;
}

fn apply_dehaze_advanced(color: vec3<f32>, coords_i: vec2<i32>, amount: f32) -> vec3<f32> {
    if (amount == 0.0) { return color; }
    let max_coords = vec2<i32>(textureDimensions(input_texture) - 1u);
    let atmospheric_light = vec3<f32>(0.95, 0.97, 1.0);
    let radius = 2;
    let window_size = f32((2 * radius + 1) * (2 * radius + 1));
    let epsilon = 0.0001;
    var mean_I: f32 = 0.0;
    var mean_p: f32 = 0.0;
    var cov_Ip: f32 = 0.0;
    var var_I: f32 = 0.0;
    for (var y = -radius; y <= radius; y = y + 1) {
        for (var x = -radius; x <= radius; x = x + 1) {
            let offset = vec2<i32>(x, y);
            let sample_coord = clamp(coords_i + offset, vec2<i32>(0), max_coords);
            let I = get_luma(srgb_to_linear(textureLoad(input_texture, sample_coord, 0).rgb));
            let dark_channel = get_dark_channel_at(sample_coord, max_coords, atmospheric_light);
            let p = 1.0 - 0.95 * dark_channel;
            mean_I += I;
            mean_p += p;
            cov_Ip += I * p;
            var_I += I * I;
        }
    }
    mean_I /= window_size;
    mean_p /= window_size;
    cov_Ip = cov_Ip / window_size - mean_I * mean_p;
    var_I = var_I / window_size - mean_I * mean_I;
    let a = cov_Ip / (var_I + epsilon);
    let b = mean_p - a * mean_I;
    let center_I = get_luma(color);
    let refined_transmission = clamp(a * center_I + b, 0.1, 1.0);
    let recovered = (color - atmospheric_light) / refined_transmission + atmospheric_light;
    var result = mix(color, recovered, abs(amount));
    if (amount > 0.0) {
        result = 0.5 + (result - 0.5) * (1.0 + amount * 0.15);
        let luma = get_luma(result);
        result = mix(vec3<f32>(luma), result, 1.0 + amount * 0.1);
    } else {
        result = mix(color, atmospheric_light, abs(amount) * 0.5);
    }
    return result;
}

fn apply_noise_reduction(color: vec3<f32>, coords_i: vec2<i32>, luma_amount: f32, color_amount: f32) -> vec3<f32> {
    if (luma_amount == 0.0 && color_amount == 0.0) { return color; }
    var accum_color = vec3<f32>(0.0);
    var total_weight = 0.0;
    let center_luma = get_luma(color);
    let max_coords = vec2<i32>(textureDimensions(input_texture) - 1u);
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let offset = vec2<i32>(x, y);
            let sample_coords = clamp(coords_i + offset, vec2<i32>(0), max_coords);
            let sample_color = srgb_to_linear(textureLoad(input_texture, sample_coords, 0).rgb);
            let luma_diff = abs(get_luma(sample_color) - center_luma);
            let color_diff = distance(sample_color, color);
            let luma_weight = 1.0 - smoothstep(0.0, 0.1, luma_diff / max(luma_amount, 0.001));
            let color_weight = 1.0 - smoothstep(0.0, 0.2, color_diff / max(color_amount, 0.001));
            let weight = luma_weight * color_weight;
            accum_color += sample_color * weight;
            total_weight += weight;
        }
    }
    if (total_weight > 0.0) { return accum_color / total_weight; }
    return color;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let in_dims = vec2<u32>(textureDimensions(input_texture));
    if (id.x >= in_dims.x || id.y >= in_dims.y) { return; }

    let original_color = textureLoad(input_texture, id.xy, 0);
    var processed_rgb = srgb_to_linear(original_color.rgb);
    let absolute_coord_i = vec2<i32>(id.xy) + vec2<i32>(i32(adjustments.tile_offset_x), i32(adjustments.tile_offset_y));

    // --- Global Adjustments ---
    let g = adjustments.global;
    processed_rgb = apply_noise_reduction(processed_rgb, absolute_coord_i, g.luma_noise_reduction, g.color_noise_reduction);
    processed_rgb = apply_dehaze_advanced(processed_rgb, absolute_coord_i, g.dehaze);
    processed_rgb = apply_tonal_adjustments(processed_rgb, g.exposure, g.contrast, g.highlights, g.shadows, g.whites, g.blacks);
    processed_rgb = apply_color_adjustments(processed_rgb, g.saturation, g.temperature, g.tint, g.vibrance);
    processed_rgb = apply_local_contrast(processed_rgb, absolute_coord_i, 2, g.sharpness);
    processed_rgb = apply_local_contrast(processed_rgb, absolute_coord_i, 8, g.clarity);
    processed_rgb = apply_local_contrast(processed_rgb, absolute_coord_i, 20, g.structure);

    var hsv = rgb_to_hsv(processed_rgb);
    if (hsv.y > 0.01) {
        var total_hue_shift: f32 = 0.0; var total_sat_adjust: f32 = 0.0; var total_lum_adjust: f32 = 0.0; var total_influence: f32 = 0.0;
        var influence = get_hsl_influence(hsv.x, 0.0, 80.0); if (influence > 0.001) { total_hue_shift += g.hsl[0].hue * influence; total_sat_adjust += g.hsl[0].saturation * influence; total_lum_adjust += g.hsl[0].luminance * influence; total_influence += influence; }
        influence = get_hsl_influence(hsv.x, 30.0, 70.0); if (influence > 0.001) { total_hue_shift += g.hsl[1].hue * influence; total_sat_adjust += g.hsl[1].saturation * influence; total_lum_adjust += g.hsl[1].luminance * influence; total_influence += influence; }
        influence = get_hsl_influence(hsv.x, 60.0, 70.0); if (influence > 0.001) { total_hue_shift += g.hsl[2].hue * influence; total_sat_adjust += g.hsl[2].saturation * influence; total_lum_adjust += g.hsl[2].luminance * influence; total_influence += influence; }
        influence = get_hsl_influence(hsv.x, 120.0, 100.0); if (influence > 0.001) { total_hue_shift += g.hsl[3].hue * influence; total_sat_adjust += g.hsl[3].saturation * influence; total_lum_adjust += g.hsl[3].luminance * influence; total_influence += influence; }
        influence = get_hsl_influence(hsv.x, 180.0, 80.0); if (influence > 0.001) { total_hue_shift += g.hsl[4].hue * influence; total_sat_adjust += g.hsl[4].saturation * influence; total_lum_adjust += g.hsl[4].luminance * influence; total_influence += influence; }
        influence = get_hsl_influence(hsv.x, 240.0, 90.0); if (influence > 0.001) { total_hue_shift += g.hsl[5].hue * influence; total_sat_adjust += g.hsl[5].saturation * influence; total_lum_adjust += g.hsl[5].luminance * influence; total_influence += influence; }
        influence = get_hsl_influence(hsv.x, 285.0, 80.0); if (influence > 0.001) { total_hue_shift += g.hsl[6].hue * influence; total_sat_adjust += g.hsl[6].saturation * influence; total_lum_adjust += g.hsl[6].luminance * influence; total_influence += influence; }
        influence = get_hsl_influence(hsv.x, 330.0, 80.0); if (influence > 0.001) { total_hue_shift += g.hsl[7].hue * influence; total_sat_adjust += g.hsl[7].saturation * influence; total_lum_adjust += g.hsl[7].luminance * influence; total_influence += influence; }
        if (total_influence > 0.001) { let norm_factor = 1.0 / total_influence; hsv.x = (hsv.x + total_hue_shift * norm_factor + 360.0) % 360.0; hsv.y = clamp(hsv.y * (1.0 + total_sat_adjust * norm_factor), 0.0, 1.0); hsv.z = clamp(hsv.z * (1.0 + total_lum_adjust * norm_factor), 0.0, 1.0); }
    }
    processed_rgb = hsv_to_rgb(hsv);

    let srgb_for_curves = linear_to_srgb(processed_rgb);
    let luma_val = get_luma(srgb_for_curves);
    let luma_curved = apply_curve(luma_val, g.luma_curve, g.luma_curve_count);
    var luma_adjusted_srgb = srgb_for_curves * (luma_curved / max(luma_val, 0.001));
    let curved_srgb = vec3<f32>(apply_curve(luma_adjusted_srgb.r, g.red_curve, g.red_curve_count), apply_curve(luma_adjusted_srgb.g, g.green_curve, g.green_curve_count), apply_curve(luma_adjusted_srgb.b, g.blue_curve, g.blue_curve_count));
    processed_rgb = srgb_to_linear(curved_srgb);

    // --- Local Adjustments (Masks) ---
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let mask_adj = adjustments.mask_adjustments[i];
        let influence = textureLoad(mask_textures, id.xy, i, 0).r;
        
        if (influence > 0.001) {
            var mask_adjusted_rgb = processed_rgb;
            mask_adjusted_rgb = apply_noise_reduction(mask_adjusted_rgb, absolute_coord_i, mask_adj.luma_noise_reduction, mask_adj.color_noise_reduction);
            mask_adjusted_rgb = apply_dehaze_advanced(mask_adjusted_rgb, absolute_coord_i, mask_adj.dehaze);
            mask_adjusted_rgb = apply_tonal_adjustments(mask_adjusted_rgb, mask_adj.exposure, mask_adj.contrast, mask_adj.highlights, mask_adj.shadows, mask_adj.whites, mask_adj.blacks);
            mask_adjusted_rgb = apply_color_adjustments(mask_adjusted_rgb, mask_adj.saturation, mask_adj.temperature, mask_adj.tint, mask_adj.vibrance);
            mask_adjusted_rgb = apply_local_contrast(mask_adjusted_rgb, absolute_coord_i, 2, mask_adj.sharpness);
            mask_adjusted_rgb = apply_local_contrast(mask_adjusted_rgb, absolute_coord_i, 8, mask_adj.clarity);
            mask_adjusted_rgb = apply_local_contrast(mask_adjusted_rgb, absolute_coord_i, 20, mask_adj.structure);

            var mask_hsv = rgb_to_hsv(mask_adjusted_rgb);
            if (mask_hsv.y > 0.01) {
                var total_hue_shift: f32 = 0.0; var total_sat_adjust: f32 = 0.0; var total_lum_adjust: f32 = 0.0; var total_influence: f32 = 0.0;
                var hsl_influence = get_hsl_influence(mask_hsv.x, 0.0, 80.0); if (hsl_influence > 0.001) { total_hue_shift += mask_adj.hsl[0].hue * hsl_influence; total_sat_adjust += mask_adj.hsl[0].saturation * hsl_influence; total_lum_adjust += mask_adj.hsl[0].luminance * hsl_influence; total_influence += hsl_influence; }
                hsl_influence = get_hsl_influence(mask_hsv.x, 30.0, 70.0); if (hsl_influence > 0.001) { total_hue_shift += mask_adj.hsl[1].hue * hsl_influence; total_sat_adjust += mask_adj.hsl[1].saturation * hsl_influence; total_lum_adjust += mask_adj.hsl[1].luminance * hsl_influence; total_influence += hsl_influence; }
                hsl_influence = get_hsl_influence(mask_hsv.x, 60.0, 70.0); if (hsl_influence > 0.001) { total_hue_shift += mask_adj.hsl[2].hue * hsl_influence; total_sat_adjust += mask_adj.hsl[2].saturation * hsl_influence; total_lum_adjust += mask_adj.hsl[2].luminance * hsl_influence; total_influence += hsl_influence; }
                hsl_influence = get_hsl_influence(mask_hsv.x, 120.0, 100.0); if (hsl_influence > 0.001) { total_hue_shift += mask_adj.hsl[3].hue * hsl_influence; total_sat_adjust += mask_adj.hsl[3].saturation * hsl_influence; total_lum_adjust += mask_adj.hsl[3].luminance * hsl_influence; total_influence += hsl_influence; }
                hsl_influence = get_hsl_influence(mask_hsv.x, 180.0, 80.0); if (hsl_influence > 0.001) { total_hue_shift += mask_adj.hsl[4].hue * hsl_influence; total_sat_adjust += mask_adj.hsl[4].saturation * hsl_influence; total_lum_adjust += mask_adj.hsl[4].luminance * hsl_influence; total_influence += hsl_influence; }
                hsl_influence = get_hsl_influence(mask_hsv.x, 240.0, 90.0); if (hsl_influence > 0.001) { total_hue_shift += mask_adj.hsl[5].hue * hsl_influence; total_sat_adjust += mask_adj.hsl[5].saturation * hsl_influence; total_lum_adjust += mask_adj.hsl[5].luminance * hsl_influence; total_influence += hsl_influence; }
                hsl_influence = get_hsl_influence(mask_hsv.x, 285.0, 80.0); if (hsl_influence > 0.001) { total_hue_shift += mask_adj.hsl[6].hue * hsl_influence; total_sat_adjust += mask_adj.hsl[6].saturation * hsl_influence; total_lum_adjust += mask_adj.hsl[6].luminance * hsl_influence; total_influence += hsl_influence; }
                hsl_influence = get_hsl_influence(mask_hsv.x, 330.0, 80.0); if (hsl_influence > 0.001) { total_hue_shift += mask_adj.hsl[7].hue * hsl_influence; total_sat_adjust += mask_adj.hsl[7].saturation * hsl_influence; total_lum_adjust += mask_adj.hsl[7].luminance * hsl_influence; total_influence += hsl_influence; }
                if (total_influence > 0.001) { let norm_factor = 1.0 / total_influence; mask_hsv.x = (mask_hsv.x + total_hue_shift * norm_factor + 360.0) % 360.0; mask_hsv.y = clamp(mask_hsv.y * (1.0 + total_sat_adjust * norm_factor), 0.0, 1.0); mask_hsv.z = clamp(mask_hsv.z * (1.0 + total_lum_adjust * norm_factor), 0.0, 1.0); }
            }
            mask_adjusted_rgb = hsv_to_rgb(mask_hsv);

            let mask_srgb_for_curves = linear_to_srgb(mask_adjusted_rgb);
            let mask_luma_val = get_luma(mask_srgb_for_curves);
            let mask_luma_curved = apply_curve(mask_luma_val, mask_adj.luma_curve, mask_adj.luma_curve_count);
            var mask_luma_adjusted_srgb = mask_srgb_for_curves * (mask_luma_curved / max(mask_luma_val, 0.001));
            let mask_curved_srgb = vec3<f32>(apply_curve(mask_luma_adjusted_srgb.r, mask_adj.red_curve, mask_adj.red_curve_count), apply_curve(mask_luma_adjusted_srgb.g, mask_adj.green_curve, mask_adj.green_curve_count), apply_curve(mask_luma_adjusted_srgb.b, mask_adj.blue_curve, mask_adj.blue_curve_count));
            mask_adjusted_rgb = srgb_to_linear(mask_curved_srgb);

            processed_rgb = mix(processed_rgb, mask_adjusted_rgb, influence);
        }
    }

    var final_rgb = linear_to_srgb(processed_rgb);

    // --- Post-processing effects ---
    let out_coord = vec2<f32>(f32(id.x), f32(id.y));
    if (g.vignette_amount != 0.0) {
        let v_amount = g.vignette_amount;
        let v_mid = g.vignette_midpoint;
        let v_round = 1.0 - g.vignette_roundness;
        let v_feather = g.vignette_feather * 0.5;
        let aspect = f32(in_dims.y) / f32(in_dims.x);
        let uv_centered = (out_coord / vec2<f32>(in_dims) - 0.5) * 2.0;
        let uv_round = sign(uv_centered) * pow(abs(uv_centered), vec2<f32>(v_round, v_round));
        let d = length(uv_round * vec2<f32>(1.0, aspect)) * 0.5;
        let vignette_mask = smoothstep(v_mid - v_feather, v_mid + v_feather, d);
        if (v_amount < 0.0) { final_rgb *= (1.0 + v_amount * vignette_mask); } else { final_rgb = mix(final_rgb, vec3<f32>(1.0), v_amount * vignette_mask); }
    }

    if (g.grain_amount > 0.0) {
        let g_amount = g.grain_amount;
        let g_size = g.grain_size;
        let g_rough = g.grain_roughness;
        let grain_uv = out_coord / g_size;
        let grain_value = rand(floor(grain_uv) + g_rough * rand(floor(grain_uv)));
        let grain_luma = (grain_value - 0.5) * g_amount;
        final_rgb += grain_luma;
    }

    textureStore(output_texture, id.xy, vec4<f32>(clamp(final_rgb, vec3<f32>(0.0), vec3<f32>(1.0)), original_color.a));
}