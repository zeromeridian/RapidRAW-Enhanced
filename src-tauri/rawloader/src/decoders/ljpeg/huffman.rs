use std::fmt;
use crate::decoders::basics::*;

const DECODE_CACHE_BITS: u32 = 13;

pub struct HuffTable {
  pub bits: [u32;17],
  pub huffval: [u32;256],
  pub shiftval: [u32;256],
  pub dng_bug: bool,
  pub disable_cache: bool,
  nbits: u32,
  hufftable: Vec<(u8,u8,u8)>,
  decodecache: [Option<(u8,i16)>; 1<< DECODE_CACHE_BITS],
  initialized: bool,
}

struct MockPump {
  bits: u64,
  nbits: u32,
}

impl MockPump {
  pub fn empty() -> Self {
    MockPump {
      bits: 0,
      nbits: 0,
    }
  }

  pub fn set(&mut self, bits: u32, nbits: u32) {
    self.bits = (bits as u64) << 32;
    self.nbits = nbits + 32;
  }

  pub fn validbits(&self) -> i32 {
    self.nbits as i32 - 32
  }
}

impl BitPump for MockPump {
  fn peek_bits(&mut self, num: u32) -> u32 {
    (self.bits >> (self.nbits-num)) as u32
  }

  fn consume_bits(&mut self, num: u32) {
    self.nbits -= num;
    self.bits &= (1 << self.nbits) - 1;
  }
}

impl HuffTable {
  pub fn empty() -> HuffTable {
    HuffTable {
      bits: [0;17],
      huffval: [0;256],
      shiftval: [0;256],
      dng_bug: false,
      disable_cache: false,
      nbits: 0,
      hufftable: Vec::new(),
      decodecache: [None; 1 << DECODE_CACHE_BITS],
      initialized: false,
    }
  }

  pub fn new(bits: [u32;17], huffval: [u32;256], dng_bug: bool) -> Result<HuffTable,String> {
    let mut tbl = HuffTable {
      bits: bits,
      huffval: huffval,
      shiftval: [0;256],
      dng_bug: dng_bug,
      disable_cache: false,
      nbits: 0,
      hufftable: Vec::new(),
      decodecache: [None; 1 << DECODE_CACHE_BITS],
      initialized: false,
    };
    tbl.initialize()?;
    Ok(tbl)
  }

  pub fn initialize(&mut self) -> Result<(), String> {
    self.nbits = 16;
    for i in 0..16 {
      if self.bits[16-i] != 0 {
        break;
      }
      self.nbits -= 1;
    }
    self.hufftable = vec![(0,0,0); 1 << self.nbits];

    let mut h = 0;
    let mut pos = 0;
    for len in 0..self.nbits {
      for _ in 0..self.bits[len as usize + 1] {
        for _ in 0..(1 << (self.nbits-len-1)) {
          self.hufftable[h] = (len as u8 + 1, self.huffval[pos] as u8, self.shiftval[pos] as u8);
          h += 1;
        }
        pos += 1;
      }
    }

    if !self.disable_cache {
      let mut pump = MockPump::empty();
      let mut i = 0;
      loop {
        pump.set(i, DECODE_CACHE_BITS);
        let (bits, decode) = self.huff_decode_slow(&mut pump);
        if pump.validbits() >= 0 {
          self.decodecache[i as usize] = Some((bits, decode as i16));
        }
        i += 1;
        if i >= 1 << DECODE_CACHE_BITS {
          break;
        }
      }
    }

    self.initialized = true;
    Ok(())
  }

  #[inline(always)]
  pub fn huff_decode(&self, pump: &mut dyn BitPump) -> Result<i32,String> {
    let code = pump.peek_bits(DECODE_CACHE_BITS) as usize;

    if let Some((bits, decode)) = self.decodecache[code] {
      pump.peek_bits(bits as u32);

      pump.consume_bits(bits as u32);
      Ok(decode as i32)
    } else {
      let (_total_bits, decode) = self.huff_decode_slow(pump);
      Ok(decode)
    }
  }

  #[inline(always)]
  pub fn huff_decode_slow(&self, pump: &mut dyn BitPump) -> (u8,i32) {
    let len = self.huff_len(pump);
    (len.0+len.1, self.huff_diff(pump, len))
  }

  #[inline(always)]
  pub fn huff_len(&self, pump: &mut dyn BitPump) -> (u8,u8,u8) {
    let code = pump.peek_bits(self.nbits) as usize;
    let (bits, len, shift) = self.hufftable[code];
    pump.consume_bits(bits as u32);
    (bits, len, shift)
  }

  #[inline(always)]
  pub fn huff_get_bits(&self, pump: &mut dyn BitPump) -> u32 {
    let code = pump.peek_bits(self.nbits) as usize;
    let (bits, len, _) = self.hufftable[code];
    pump.consume_bits(bits as u32);
    len as u32
  }

  #[inline(always)]
  pub fn huff_diff(&self, pump: &mut dyn BitPump, input: (u8,u8,u8)) -> i32 {
    let (_, len, shift) = input;

    match len {
      0 => 0,
      16 => {
        if self.dng_bug {
          pump.get_bits(16);
        }
        -32768
      },
      len => {
        let fulllen: i32 = len as i32 + shift as i32;
        let shift: i32 = shift as i32;
        let bits = pump.get_bits(len as u32) as i32;
        let mut diff: i32 = ((bits << 1) + 1) << shift >> 1;
        if (diff & (1 << (fulllen - 1))) == 0 {
          diff -= (1 << fulllen) - ((shift == 0) as i32);
        }
        diff
      },
    }
  }
}

impl fmt::Debug for HuffTable {
  fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    if self.initialized {
      write!(f, "HuffTable {{ bits: {:?} huffval: {:?} }}", self.bits, &self.huffval[..])
    } else {
      write!(f, "HuffTable {{ uninitialized }}")
    }
  }
}