// Shared by every compute group in `gpu_compute.rs`; appended after the group's source, whose
// `Params` (binding 7) starts with `grid: Grid`. Binding numbers follow upstream's layout.

struct Grid {
    dst: vec2<u32>,
    src: vec2<u32>,
    radius: u32,
    channel: u32,
    flags: u32,
    eps: f32,
}

@group(0) @binding(0) var t0: texture_2d<f32>;
@group(0) @binding(1) var t1: texture_2d<f32>;
@group(0) @binding(2) var t2: texture_2d<f32>;
@group(0) @binding(3) var t3: texture_2d<f32>;
@group(0) @binding(4) var t4: texture_2d<f32>;
@group(0) @binding(5) var t5: texture_2d<f32>;
@group(0) @binding(8) var out_f32: texture_storage_2d<rgba32float, write>;
@group(0) @binding(9) var out_f16: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var out_r32: texture_storage_2d<r32float, write>;
@group(0) @binding(11) var<storage, read_write> scratch: array<atomic<u32>>;
@group(0) @binding(12) var<storage, read> data: array<vec4<f32>>;

// `gpu_compute::KEEP_ZW`.
const KEEP_ZW: u32 = 1u;

// Four texels around a point and the bilinear weights between them.
struct Tap {
    p00: vec2<i32>,
    p11: vec2<i32>,
    w: vec2<f32>,
}

fn outside(id: vec3<u32>) -> bool {
    return id.x >= params.grid.dst.x || id.y >= params.grid.dst.y;
}

fn smooth_step(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp((x - e0) / max(e1 - e0, 1e-6), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn plain_luma(c: vec3<f32>) -> f32 {
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

fn sqrt_luma(c: vec3<f32>) -> f32 {
    return sqrt(max(plain_luma(c), 0.0));
}

// Texel coordinates `f` clamped into `size`, as the CPU effects' bilinear lookups do.
fn tap_from(f: vec2<f32>, size: vec2<u32>) -> Tap {
    let last = vec2<f32>(size) - 1.0;
    let c = clamp(f, vec2<f32>(0.0), last);
    let p0 = vec2<i32>(floor(c));
    let p1 = min(p0 + vec2<i32>(1), vec2<i32>(size) - vec2<i32>(1));
    return Tap(p0, p1, c - vec2<f32>(p0));
}

// The texel centres around `uv` (0–1) in a texture of `size`.
fn tap_uv(uv: vec2<f32>, size: vec2<u32>) -> Tap {
    return tap_from(uv * vec2<f32>(size) - 0.5, size);
}

fn tap_sample(t: texture_2d<f32>, tap: Tap) -> vec4<f32> {
    let a = textureLoad(t, tap.p00, 0);
    let b = textureLoad(t, vec2<i32>(tap.p11.x, tap.p00.y), 0);
    let c = textureLoad(t, vec2<i32>(tap.p00.x, tap.p11.y), 0);
    let d = textureLoad(t, tap.p11, 0);
    let top = a + (b - a) * tap.w.x;
    let bot = c + (d - c) * tap.w.x;
    return top + (bot - top) * tap.w.y;
}

// One direction of `ComputeEncoder::blur`: the mean over `2 * radius + 1` texels, clamped at
// the edges.
fn box_pass(id: vec3<u32>, dir: vec2<i32>) {
    if (outside(id)) { return; }
    let r = i32(params.grid.radius);
    let last = vec2<i32>(params.grid.dst) - vec2<i32>(1);
    let p = vec2<i32>(id.xy);
    var sum = vec4<f32>(0.0);
    for (var k = -r; k <= r; k++) {
        sum += textureLoad(t0, clamp(p + dir * k, vec2<i32>(0), last), 0);
    }
    var v = sum * (1.0 / f32(2 * r + 1));
    if ((params.grid.flags & KEEP_ZW) != 0u) {
        v = vec4<f32>(v.xy, textureLoad(t0, p, 0).zw);
    }
    textureStore(out_f32, id.xy, v);
}

@compute @workgroup_size(8, 8, 1)
fn box_h(@builtin(global_invocation_id) id: vec3<u32>) {
    box_pass(id, vec2<i32>(1, 0));
}

@compute @workgroup_size(8, 8, 1)
fn box_v(@builtin(global_invocation_id) id: vec3<u32>) {
    box_pass(id, vec2<i32>(0, 1));
}
