// Orientation, flips, rotation, crop and downscaling of the prepared photo (`render_source.rs`),
// plus the motion-blur grain estimate. Each stage matches the CPU code it replaces, which stays
// as the fallback: `tf_frame` the image crate's rotate/flip, imageproc's `rotate_about_center`
// and `apply_crop`; `tf_downscale` the fork's root-mean-square `downscale_f32_image`;
// `tf_grain` `motion_blur::estimate_grain`'s blocks.

struct Params {
    grid: Grid,
    orientation: u32,
    rotation: vec4<f32>,
    rotation_offset: vec2<f32>,
    crop_origin: vec2<u32>,
    oriented_size: vec2<u32>,
    flip: vec2<u32>,
    grain: vec4<u32>,
}

@group(0) @binding(7) var<uniform> params: Params;

const FRAME_ROTATE: u32 = 1u;

// The source pixel at `p` of the oriented (coarse-rotated, then flipped) image; black and
// transparent outside it, like imageproc's constant border.
fn oriented(p: vec2<i32>) -> vec4<f32> {
    let size = vec2<i32>(params.oriented_size);
    if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) {
        return vec4<f32>(0.0);
    }
    var q = p;
    if (params.flip.x != 0u) { q.x = size.x - 1 - q.x; }
    if (params.flip.y != 0u) { q.y = size.y - 1 - q.y; }
    let src = vec2<i32>(params.grid.src);
    var s = q;
    switch params.orientation {
        case 1u: { s = vec2<i32>(q.y, src.y - 1 - q.x); }
        case 2u: { s = vec2<i32>(src.x - 1 - q.x, src.y - 1 - q.y); }
        case 3u: { s = vec2<i32>(src.x - 1 - q.y, q.x); }
        default: {}
    }
    return textureLoad(t0, s, 0);
}

@compute @workgroup_size(8, 8, 1)
fn tf_frame(@builtin(global_invocation_id) id: vec3<u32>) {
    if (outside(id)) { return; }
    let p = vec2<f32>(id.xy + params.crop_origin);
    if ((params.grid.flags & FRAME_ROTATE) == 0u) {
        textureStore(out_f16, id.xy, oriented(vec2<i32>(p)));
        return;
    }
    // imageproc maps the output pixel's integer coordinates through the inverse rotation
    // about the image centre and blends the four taps, each black outside the image.
    let r = params.rotation;
    let s = vec2<f32>(r.x * p.x + r.y * p.y, r.z * p.x + r.w * p.y) + params.rotation_offset;
    let left = i32(floor(s.x));
    let top = i32(floor(s.y));
    let w = s - vec2<f32>(f32(left), f32(top));
    let upper = oriented(vec2<i32>(left, top)) * (1.0 - w.x) + oriented(vec2<i32>(left + 1, top)) * w.x;
    let lower = oriented(vec2<i32>(left, top + 1)) * (1.0 - w.x) + oriented(vec2<i32>(left + 1, top + 1)) * w.x;
    textureStore(out_f16, id.xy, upper * (1.0 - w.y) + lower * w.y);
}

// Area-weighted root mean square of the source pixels the output pixel covers (negative
// values count as 0), as `downscale_f32_image`.
@compute @workgroup_size(8, 8, 1)
fn tf_downscale(@builtin(global_invocation_id) id: vec3<u32>) {
    if (outside(id)) { return; }
    let src = params.grid.src;
    let ratio = vec2<f32>(src) / vec2<f32>(params.grid.dst);
    let start = vec2<f32>(id.xy) * ratio;
    let end = vec2<f32>(id.xy + 1u) * ratio;
    let lo = vec2<u32>(floor(start));
    let hi = min(vec2<u32>(ceil(end)), src);
    var total = vec2<f32>(0.0);
    for (var x = lo.x; x < hi.x; x++) {
        total.x += max(min(end.x, f32(x + 1u)) - max(start.x, f32(x)), 0.0);
    }
    for (var y = lo.y; y < hi.y; y++) {
        total.y += max(min(end.y, f32(y + 1u)) - max(start.y, f32(y)), 0.0);
    }
    var acc = vec3<f32>(0.0);
    if (total.x > 0.0 && total.y > 0.0) {
        let inv = 1.0 / total;
        for (var y = lo.y; y < hi.y; y++) {
            let wy = max(min(end.y, f32(y + 1u)) - max(start.y, f32(y)), 0.0) * inv.y;
            if (wy <= 0.0) { continue; }
            for (var x = lo.x; x < hi.x; x++) {
                let wx = max(min(end.x, f32(x + 1u)) - max(start.x, f32(x)), 0.0) * inv.x;
                if (wx <= 0.0) { continue; }
                let c = max(textureLoad(t0, vec2<u32>(x, y), 0).rgb, vec3<f32>(0.0));
                acc += c * c * (wx * wy);
            }
        }
    }
    textureStore(out_f16, id.xy, vec4<f32>(sqrt(acc), 1.0));
}

fn grain_luma(p: vec2<u32>) -> f32 {
    let v = max(plain_luma(textureLoad(t0, p, 0).rgb), 0.0);
    if (params.grain.w == 0u) {
        return v;
    }
    if (v <= 0.0031308) {
        return v * 12.92;
    }
    return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

// One 8×8 block per invocation, every `grain.x` pixels from (1, 1): the RMS of the luma's
// Laplacian residual, stored as f32 bits in `scratch`.
@compute @workgroup_size(8, 8, 1)
fn tf_grain(@builtin(global_invocation_id) id: vec3<u32>) {
    let blocks = params.grain.yz;
    if (id.x >= blocks.x || id.y >= blocks.y) { return; }
    let origin = vec2<u32>(1u) + id.xy * params.grain.x;
    var energy = 0.0;
    for (var y = 0u; y < 8u; y++) {
        for (var x = 0u; x < 8u; x++) {
            let p = origin + vec2<u32>(x, y);
            let around = grain_luma(p - vec2<u32>(1u, 0u)) + grain_luma(p + vec2<u32>(1u, 0u))
                + grain_luma(p - vec2<u32>(0u, 1u)) + grain_luma(p + vec2<u32>(0u, 1u));
            let r = grain_luma(p) - 0.25 * around;
            energy += r * r;
        }
    }
    atomicStore(&scratch[id.y * blocks.x + id.x], bitcast<u32>(sqrt(energy / 64.0)));
}
