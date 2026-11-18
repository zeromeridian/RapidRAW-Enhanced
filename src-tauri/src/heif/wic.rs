//! HEIF decoding through the Windows Imaging Component, which decodes HEIF with Microsoft's
//! "HEIF Image Extensions" and "HEVC Video Extensions" from the Microsoft Store. WIC returns
//! the stored image without its rotation and without colour management, so its pixels are
//! read as they are.

use anyhow::{Result, anyhow};
use image::{DynamicImage, ImageBuffer, Rgb};
use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, WINCODEC_ERR_COMPONENTNOTFOUND};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat48bppRGB, IWICImagingFactory,
    WICConvertBitmapSource, WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
};

/// The Windows counterpart of the Linux install hint (Plan item 48, decision 4).
const INSTALL_HINT: &str = "HEIF images on Windows need the \"HEIF Image Extensions\" and \
     \"HEVC Video Extensions\" from the Microsoft Store.";

fn wic_error(error: windows::core::Error) -> anyhow::Error {
    if error.code() == WINCODEC_ERR_COMPONENTNOTFOUND {
        anyhow!("Windows cannot decode this HEIF image. {INSTALL_HINT}")
    } else {
        anyhow!("Windows failed to decode this HEIF image: {error}")
    }
}

pub fn decode_coded(bytes: &[u8]) -> Result<DynamicImage> {
    // SAFETY: COM is initialised for this thread before any COM call; a thread already
    // initialised in another mode keeps it (RPC_E_CHANGED_MODE), which WIC accepts.
    unsafe {
        let init = CoInitializeEx(None, COINIT_MULTITHREADED);
        if init.is_err() && init != RPC_E_CHANGED_MODE {
            return Err(anyhow!("COM initialisation failed: {init:?}"));
        }

        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
                .map_err(wic_error)?;
        let stream = factory.CreateStream().map_err(wic_error)?;
        stream.InitializeFromMemory(bytes).map_err(wic_error)?;
        let decoder = factory
            .CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)
            .map_err(wic_error)?;
        let frame = decoder.GetFrame(0).map_err(wic_error)?;
        // 16 bits per channel keeps 10-bit files at full precision; 8-bit files scale exactly.
        let source =
            WICConvertBitmapSource(&GUID_WICPixelFormat48bppRGB, &frame).map_err(wic_error)?;

        let (mut width, mut height) = (0u32, 0u32);
        source.GetSize(&mut width, &mut height).map_err(wic_error)?;
        let stride = width as usize * 6;
        let mut buffer = vec![0u8; stride * height as usize];
        source
            .CopyPixels(std::ptr::null(), stride as u32, &mut buffer)
            .map_err(wic_error)?;

        let values = buffer
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        ImageBuffer::<Rgb<u16>, _>::from_raw(width, height, values)
            .map(DynamicImage::ImageRgb16)
            .ok_or_else(|| anyhow!("Windows returned a HEIF image of the wrong size"))
    }
}
