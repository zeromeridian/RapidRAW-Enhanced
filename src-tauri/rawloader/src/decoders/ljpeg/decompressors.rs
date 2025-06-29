use crate::decoders::basics::*;
use crate::decoders::ljpeg::LjpegDecompressor;
use crate::decoders::ljpeg::huffman::*;

pub fn decode_dji_interleaved(ljpeg: &LjpegDecompressor, out: &mut [u16], x: usize, stripwidth: usize, width: usize, _height: usize) -> Result<(),String> {
    let sof_width = ljpeg.sof.width;
    let sof_height = ljpeg.sof.height;

    let mut temp_buf = vec![0u16; sof_width * sof_height];
    decode_ljpeg_predictor6_flat(ljpeg, &mut temp_buf, sof_width, sof_height)?;

    for y in 0..sof_height {
        let src_row_start = y * sof_width;
        let dst_row1_start = (y * 2) * stripwidth + x;
        let dst_row2_start = (y * 2 + 1) * stripwidth + x;

        let src_slice1 = &temp_buf[src_row_start .. src_row_start + width];
        out[dst_row1_start .. dst_row1_start + width].copy_from_slice(src_slice1);

        let src_slice2 = &temp_buf[src_row_start + width .. src_row_start + sof_width];
        out[dst_row2_start .. dst_row2_start + width].copy_from_slice(src_slice2);
    }

    Ok(())
}

pub fn decode_ljpeg_predictor6_flat(ljpeg: &LjpegDecompressor, out: &mut [u16], width: usize, height: usize) -> Result<(), String> {
    let ref htable = ljpeg.dhts[ljpeg.sof.components[0].dc_tbl_num];
    let mut pump = BitPumpJPEG::new(ljpeg.buffer);
    let base_prediction = 1 << (ljpeg.sof.precision - 1);
    let pt = ljpeg.point_transform;

    let diff0 = htable.huff_decode(&mut pump)?;
    let val0 = base_prediction + diff0;
    out[0] = (val0 >> pt) as u16;

    for x in 1..width {
        let pred = out[x - 1] as i32;
        let diff = htable.huff_decode(&mut pump)?;
        out[x] = ((pred + diff) >> pt) as u16;
    }

    for y in 1..height {
        let row_start = y * width;
        let prev_row_start = (y - 1) * width;

        let pred = out[prev_row_start] as i32;
        let diff = htable.huff_decode(&mut pump)?;
        let val = pred + diff;
        out[row_start] = (val >> pt) as u16;

        for x in 1..width {
            let ra = out[row_start + x - 1] as i32;
            let rb = out[prev_row_start + x] as i32;
            let rc = out[prev_row_start + x - 1] as i32;
            let pred = rb + ((ra - rc) >> 1);
            let diff = htable.huff_decode(&mut pump)?;
            let val = pred + diff;
            out[row_start + x] = (val >> pt) as u16;
        }
    }
    Ok(())
}

pub fn decode_ljpeg_1component(ljpeg: &LjpegDecompressor, out: &mut [u16], x: usize, stripwidth:usize, width: usize, height: usize) -> Result<(),String> {
  if ljpeg.sof.width < width || ljpeg.sof.height < height {
    return Err(format!("ljpeg: trying to decode {}x{} into {}x{}",
                       ljpeg.sof.width, ljpeg.sof.height,
                       width, height).to_string())
  }
  let ref htable = ljpeg.dhts[ljpeg.sof.components[0].dc_tbl_num];
  let mut pump = BitPumpJPEG::new(ljpeg.buffer);
  let pt = ljpeg.point_transform;

  let base_prediction = 1 << (ljpeg.sof.precision - 1);
  out[x] = ((base_prediction + htable.huff_decode(&mut pump)?) >> pt) as u16;
  let skip_x = ljpeg.sof.width - width;

  for row in 0..height {
    let startcol = if row == 0 {x+1} else {x};
    for col in startcol..(width+x) {
      let p = if col == x {
        out[(row-1)*stripwidth+x]
      } else {
        out[row*stripwidth+col-1]
      };

      let diff = htable.huff_decode(&mut pump)?;
      out[row*stripwidth+col] = (((p as i32) + diff) >> pt) as u16;
    }
    for _ in 0..skip_x {
      htable.huff_decode(&mut pump)?;
    }
  }

  Ok(())
}

pub fn decode_ljpeg_2components(ljpeg: &LjpegDecompressor, out: &mut [u16], x: usize, stripwidth:usize, width: usize, height: usize) -> Result<(),String> {
  if ljpeg.sof.width*2 < width || ljpeg.sof.height < height {
    return Err(format!("ljpeg: trying to decode {}x{} into {}x{}",
                       ljpeg.sof.width*2, ljpeg.sof.height,
                       width, height).to_string())
  }
  let ref htable1 = ljpeg.dhts[ljpeg.sof.components[0].dc_tbl_num];
  let ref htable2 = ljpeg.dhts[ljpeg.sof.components[1].dc_tbl_num];
  let mut pump = BitPumpJPEG::new(ljpeg.buffer);
  let pt = ljpeg.point_transform;

  let base_prediction = 1 << (ljpeg.sof.precision - 1);
  out[x]   = ((base_prediction + htable1.huff_decode(&mut pump)?) >> pt) as u16;
  out[x+1] = ((base_prediction + htable2.huff_decode(&mut pump)?) >> pt) as u16;
  let skip_x = ljpeg.sof.width - width/2;

  for row in 0..height {
    let startcol = if row == 0 {x+2} else {x};
    for col in (startcol..(width+x)).step_by(2) {
      let (p1,p2) = if col == x {
        (out[(row-1)*stripwidth+x],out[(row-1)*stripwidth+1+x])
      } else {
        (out[row*stripwidth+col-2], out[row*stripwidth+col-1])
      };

      let diff1 = htable1.huff_decode(&mut pump)?;
      let diff2 = htable2.huff_decode(&mut pump)?;
      out[row*stripwidth+col] = (((p1 as i32) + diff1) >> pt) as u16;
      out[row*stripwidth+col+1] = (((p2 as i32) + diff2) >> pt) as u16;
    }
    for _ in 0..skip_x {
      htable1.huff_decode(&mut pump)?;
      htable2.huff_decode(&mut pump)?;
    }
  }

  Ok(())
}

pub fn decode_ljpeg_3components(ljpeg: &LjpegDecompressor, out: &mut [u16], x: usize, stripwidth:usize, width: usize, height: usize) -> Result<(),String> {
  if ljpeg.sof.width*3 < width || ljpeg.sof.height < height {
    return Err(format!("ljpeg: trying to decode {}x{} into {}x{}",
                       ljpeg.sof.width*3, ljpeg.sof.height,
                       width, height).to_string())
  }

  let ref htable1 = ljpeg.dhts[ljpeg.sof.components[0].dc_tbl_num];
  let ref htable2 = ljpeg.dhts[ljpeg.sof.components[1].dc_tbl_num];
  let ref htable3 = ljpeg.dhts[ljpeg.sof.components[2].dc_tbl_num];
  let mut pump = BitPumpJPEG::new(ljpeg.buffer);
  let pt = ljpeg.point_transform;

  let base_prediction = 1 << (ljpeg.sof.precision - 1);
  out[x]   = ((base_prediction + htable1.huff_decode(&mut pump)?) >> pt) as u16;
  out[x+1] = ((base_prediction + htable2.huff_decode(&mut pump)?) >> pt) as u16;
  out[x+2] = ((base_prediction + htable3.huff_decode(&mut pump)?) >> pt) as u16;
  let skip_x = ljpeg.sof.width - width/3;

  for row in 0..height {
    let startcol = if row == 0 {x+3} else {x};
    for col in (startcol..(width+x)).step_by(3) {
      let pos = if col == x {
        (row-1)*stripwidth+x
      } else {
        row*stripwidth+col-3
      };
      let (p1,p2,p3) = (out[pos],out[pos+1],out[pos+2]);

      let diff1 = htable1.huff_decode(&mut pump)?;
      let diff2 = htable2.huff_decode(&mut pump)?;
      let diff3 = htable3.huff_decode(&mut pump)?;
      out[row*stripwidth+col] = (((p1 as i32) + diff1) >> pt) as u16;
      out[row*stripwidth+col+1] = (((p2 as i32) + diff2) >> pt) as u16;
      out[row*stripwidth+col+2] = (((p3 as i32) + diff3) >> pt) as u16;
    }
    for _ in 0..skip_x {
      htable1.huff_decode(&mut pump)?;
      htable2.huff_decode(&mut pump)?;
      htable3.huff_decode(&mut pump)?;
    }
  }

  Ok(())
}

pub fn decode_ljpeg_4components(ljpeg: &LjpegDecompressor, out: &mut [u16], width: usize, height: usize) -> Result<(),String> {
  if ljpeg.sof.width*4 < width || ljpeg.sof.height < height {
    return Err(format!("ljpeg: trying to decode {}x{} into {}x{}",
                       ljpeg.sof.width*4, ljpeg.sof.height,
                       width, height).to_string())
  }
  let ref htable1 = ljpeg.dhts[ljpeg.sof.components[0].dc_tbl_num];
  let ref htable2 = ljpeg.dhts[ljpeg.sof.components[1].dc_tbl_num];
  let ref htable3 = ljpeg.dhts[ljpeg.sof.components[2].dc_tbl_num];
  let ref htable4 = ljpeg.dhts[ljpeg.sof.components[3].dc_tbl_num];
  let mut pump = BitPumpJPEG::new(ljpeg.buffer);
  let pt = ljpeg.point_transform;

  let base_prediction = 1 << (ljpeg.sof.precision - 1);
  out[0] = ((base_prediction + htable1.huff_decode(&mut pump)?) >> pt) as u16;
  out[1] = ((base_prediction + htable2.huff_decode(&mut pump)?) >> pt) as u16;
  out[2] = ((base_prediction + htable3.huff_decode(&mut pump)?) >> pt) as u16;
  out[3] = ((base_prediction + htable4.huff_decode(&mut pump)?) >> pt) as u16;
  let skip_x = ljpeg.sof.width - width/4;

  for row in 0..height {
    let startcol = if row == 0 {4} else {0};
    for col in (startcol..width).step_by(4) {
      let pos = if col == 0 {
        (row-1)*width
      } else {
        row*width+col-4
      };

      let (p1,p2,p3,p4) = (out[pos],out[pos+1],out[pos+2],out[pos+3]);

      let diff1 = htable1.huff_decode(&mut pump)?;
      let diff2 = htable2.huff_decode(&mut pump)?;
      let diff3 = htable3.huff_decode(&mut pump)?;
      let diff4 = htable4.huff_decode(&mut pump)?;
      out[row*width+col] = (((p1 as i32) + diff1) >> pt) as u16;
      out[row*width+col+1] = (((p2 as i32) + diff2) >> pt) as u16;
      out[row*width+col+2] = (((p3 as i32) + diff3) >> pt) as u16;
      out[row*width+col+3] = (((p4 as i32) + diff4) >> pt) as u16;
    }
    for _ in 0..skip_x {
      htable1.huff_decode(&mut pump)?;
      htable2.huff_decode(&mut pump)?;
      htable3.huff_decode(&mut pump)?;
      htable4.huff_decode(&mut pump)?;
    }
  }

  Ok(())
}

fn set_yuv_420(out: &mut [u16], row: usize, col: usize, width: usize, y1: i32, y2: i32, y3: i32, y4: i32, cb: i32, cr: i32) {
  let pix1 = row*width+col;
  let pix2 = pix1+3;
  let pix3 = (row+1)*width+col;
  let pix4 = pix3+3;

  out[pix1+0] = y1 as u16;
  out[pix1+1] = cb as u16;
  out[pix1+2] = cr as u16;
  out[pix2+0] = y2 as u16;
  out[pix2+1] = cb as u16;
  out[pix2+2] = cr as u16;
  out[pix3+0] = y3 as u16;
  out[pix3+1] = cb as u16;
  out[pix3+2] = cr as u16;
  out[pix4+0] = y4 as u16;
  out[pix4+1] = cb as u16;
  out[pix4+2] = cr as u16;
}

pub fn decode_ljpeg_420(ljpeg: &LjpegDecompressor, out: &mut [u16], width: usize, height: usize) -> Result<(),String> {
  if ljpeg.sof.width*3 != width || ljpeg.sof.height != height {
    return Err(format!("ljpeg: trying to decode {}x{} into {}x{}",
                       ljpeg.sof.width*3, ljpeg.sof.height,
                       width, height).to_string())
  }

  let ref htable1 = ljpeg.dhts[ljpeg.sof.components[0].dc_tbl_num];
  let ref htable2 = ljpeg.dhts[ljpeg.sof.components[1].dc_tbl_num];
  let ref htable3 = ljpeg.dhts[ljpeg.sof.components[2].dc_tbl_num];
  let mut pump = BitPumpJPEG::new(ljpeg.buffer);

  let base_prediction = 1 << (ljpeg.sof.precision - ljpeg.point_transform -1);
  let y1 = base_prediction + htable1.huff_decode(&mut pump)?;
  let y2 = y1 + htable1.huff_decode(&mut pump)?;
  let y3 = y2 + htable1.huff_decode(&mut pump)?;
  let y4 = y3 + htable1.huff_decode(&mut pump)?;
  let cb = base_prediction + htable2.huff_decode(&mut pump)?;
  let cr = base_prediction + htable3.huff_decode(&mut pump)?;
  set_yuv_420(out, 0, 0, width, y1, y2, y3, y4, cb, cr);

  for row in (0..height).step_by(2) {
    let startcol = if row == 0 {6} else {0};
    for col in (startcol..width).step_by(6) {
      let pos = if col == 0 {
        (row-2)*width
      } else {
        (row+1)*width+col-3
      };
      let (py,pcb,pcr) = (out[pos],out[pos+1],out[pos+2]);

      let y1 = (py  as i32) + htable1.huff_decode(&mut pump)?;
      let y2 = (y1  as i32) + htable1.huff_decode(&mut pump)?;
      let y3 = (y2  as i32) + htable1.huff_decode(&mut pump)?;
      let y4 = (y3  as i32) + htable1.huff_decode(&mut pump)?;
      let cb = (pcb as i32) + htable2.huff_decode(&mut pump)?;
      let cr = (pcr as i32) + htable3.huff_decode(&mut pump)?;
      set_yuv_420(out, row, col, width, y1, y2, y3, y4, cb, cr);
    }
  }

  Ok(())
}

fn set_yuv_422(out: &mut [u16], row: usize, col: usize, width: usize, y1: i32, y2: i32, cb: i32, cr: i32) {
  let pix1 = row*width+col;
  let pix2 = pix1+3;

  out[pix1+0] = y1 as u16;
  out[pix1+1] = cb as u16;
  out[pix1+2] = cr as u16;
  out[pix2+0] = y2 as u16;
  out[pix2+1] = cb as u16;
  out[pix2+2] = cr as u16;
}

pub fn decode_ljpeg_422(ljpeg: &LjpegDecompressor, out: &mut [u16], width: usize, height: usize) -> Result<(),String> {
  if ljpeg.sof.width*3 != width || ljpeg.sof.height != height {
    return Err(format!("ljpeg: trying to decode {}x{} into {}x{}",
                       ljpeg.sof.width*3, ljpeg.sof.height,
                       width, height).to_string())
  }
  let ref htable1 = ljpeg.dhts[ljpeg.sof.components[0].dc_tbl_num];
  let ref htable2 = ljpeg.dhts[ljpeg.sof.components[1].dc_tbl_num];
  let ref htable3 = ljpeg.dhts[ljpeg.sof.components[2].dc_tbl_num];
  let mut pump = BitPumpJPEG::new(ljpeg.buffer);

  let base_prediction = 1 << (ljpeg.sof.precision - ljpeg.point_transform -1);
  let y1 = base_prediction + htable1.huff_decode(&mut pump)?;
  let y2 = y1 + htable1.huff_decode(&mut pump)?;
  let cb = base_prediction + htable2.huff_decode(&mut pump)?;
  let cr = base_prediction + htable3.huff_decode(&mut pump)?;
  set_yuv_422(out, 0, 0, width, y1, y2, cb, cr);

  for row in 0..height {
    let startcol = if row == 0 {6} else {0};
    for col in (startcol..width).step_by(6) {
      let pos = if col == 0 {
        (row-1)*width
      } else {
        row*width+col-3
      };
      let (py,pcb,pcr) = (out[pos],out[pos+1],out[pos+2]);

      let y1 = (py  as i32) + htable1.huff_decode(&mut pump)?;
      let y2 = (y1  as i32) + htable1.huff_decode(&mut pump)?;
      let cb = (pcb as i32) + htable2.huff_decode(&mut pump)?;
      let cr = (pcr as i32) + htable3.huff_decode(&mut pump)?;
      set_yuv_422(out, row, col, width, y1, y2, cb, cr);
    }
  }

  Ok(())
}

pub fn decode_hasselblad(ljpeg: &LjpegDecompressor, out: &mut [u16], width: usize) -> Result<(),String> {
  let mut pump = BitPumpMSB32::new(ljpeg.buffer);
  let ref htable = ljpeg.dhts[ljpeg.sof.components[0].dc_tbl_num];

  for line in out.chunks_exact_mut(width) {
    let mut p1: i32 = 0x8000;
    let mut p2: i32 = 0x8000;
    for o in line.chunks_exact_mut(2) {
      let len1 = htable.huff_len(&mut pump);
      let len2 = htable.huff_len(&mut pump);
      p1 += htable.huff_diff(&mut pump, len1);
      p2 += htable.huff_diff(&mut pump, len2);
      o[0] = p1 as u16;
      o[1] = p2 as u16;
    }
  }

  Ok(())
}

pub fn decode_leaf_strip(src: &[u8], out: &mut [u16], width: usize, height: usize, htable1: &HuffTable, htable2: &HuffTable, bpred: i32) -> Result<(),String> {
  let mut pump = BitPumpJPEG::new(src);
  out[0] = (bpred + htable1.huff_decode(&mut pump)?) as u16;
  out[1] = (bpred + htable2.huff_decode(&mut pump)?) as u16;
  for row in 0..height {
    let startcol = if row == 0 {2} else {0};
    for col in (startcol..width).step_by(2) {
      let pos = if col == 0 {
        (row-1)*width
      } else {
        row*width+col-2
      };
      let (p1,p2) = (out[pos],out[pos+1]);

      let diff1 = htable1.huff_decode(&mut pump)?;
      let diff2 = htable2.huff_decode(&mut pump)?;
      out[row*width+col]   = ((p1 as i32) + diff1) as u16;
      out[row*width+col+1] = ((p2 as i32) + diff2) as u16;
    }
  }

  Ok(())
}