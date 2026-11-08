/** Pixel size recorded in an image's EXIF, or null when it has none. */
export const getImageDimensions = (exif: Record<string, string> | null | undefined) => {
  if (!exif) return null;

  const parseDimension = (keys: string[]) => {
    for (const key of keys) {
      const value = Number.parseInt(exif[key] ?? '', 10);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  };

  const width = parseDimension(['PixelXDimension', 'ExifImageWidth', 'ImageWidth']);
  const height = parseDimension(['PixelYDimension', 'ExifImageHeight', 'ImageLength']);
  return width && height ? { width, height } : null;
};
