// Shared by every compute group in `gpu_compute.rs`; appended after the group's source, whose
// `Params` (binding 7) starts with `grid: Grid`. Binding numbers follow upstream's layout.

struct Grid {
    dst: vec2<u32>,
    src: vec2<u32>,
    _radius: u32,
    _channel: u32,
    flags: u32,
    _eps: f32,
}

@group(0) @binding(0) var t0: texture_2d<f32>;
@group(0) @binding(9) var out_f16: texture_storage_2d<rgba16float, write>;
@group(0) @binding(11) var<storage, read_write> scratch: array<atomic<u32>>;

fn outside(id: vec3<u32>) -> bool {
    return id.x >= params.grid.dst.x || id.y >= params.grid.dst.y;
}

fn plain_luma(c: vec3<f32>) -> f32 {
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
