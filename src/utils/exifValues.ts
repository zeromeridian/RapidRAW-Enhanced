/** Reading the EXIF strings the backend lists per photo (`ImageFile.exif`) as values. */

export type ExifMap = { [key: string]: string } | null | undefined;

/** The EXIF reader keeps quotes around strings; empty when the tag is missing. */
export function exifText(value: unknown) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/"/g, '').trim();
}

/**
 * Make and model as one name, without repeating a make the model already starts with
 * ("Canon" + "Canon EOS R5", "NIKON CORPORATION" + "NIKON Z 6").
 */
export function formatCameraName(make: string, model: string) {
  const makeWord = make.split(/\s+/)[0].toLowerCase();
  const modelLower = model.toLowerCase();
  const repeatsMake = makeWord !== '' && (modelLower === makeWord || modelLower.startsWith(`${makeWord} `));
  return [repeatsMake ? '' : make, model].filter(Boolean).join(' ');
}

/** An exposure time such as "1/250" or "2.5 s" in seconds; 0 when there is none. */
export const parseShutter = (val: string | undefined): number => {
  if (!val) return 0;
  const cleanVal = val.replace(/s/i, '').trim();
  const parts = cleanVal.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    return den !== 0 ? num / den : 0;
  }
  const numVal = parseFloat(cleanVal);
  return isNaN(numVal) ? 0 : numVal;
};

/** The first number in an EXIF text such as "f/2.8" or "50.0 mm"; 0 when there is none. */
const parseExifNumber = (val: string | undefined): number => {
  const match = val?.match(/(\d+(\.\d+)?)/);
  const numVal = match ? parseFloat(match[0]) : 0;
  return isNaN(numVal) ? 0 : numVal;
};

export const parseAperture = parseExifNumber;
export const parseFocalLength = parseExifNumber;

/** The ISO speed; 0 when there is none. */
export const getIso = (exif: ExifMap): number =>
  parseInt(exif?.PhotographicSensitivity || exif?.ISOSpeedRatings || '0', 10) || 0;
