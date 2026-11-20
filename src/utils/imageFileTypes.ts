import { ImageFile, ImageFileType } from '../components/ui/AppProperties';
import { getFileExtension } from './imageGrouping';

const JPEG_EXTENSIONS = new Set(['jpg', 'jpeg']);
const HEIF_EXTENSIONS = new Set(['heic', 'heif', 'hif']);
const TIFF_EXTENSIONS = new Set(['tif', 'tiff']);

/** The file type the Quick Filter and Select By sort an image under; null for a format without one. */
export function getImageFileType(image: ImageFile): ImageFileType | null {
  if (image.is_raw) return ImageFileType.Raw;
  const extension = getFileExtension(image.path);
  if (JPEG_EXTENSIONS.has(extension)) return ImageFileType.Jpeg;
  if (HEIF_EXTENSIONS.has(extension)) return ImageFileType.Heif;
  if (TIFF_EXTENSIONS.has(extension)) return ImageFileType.Tiff;
  return null;
}
