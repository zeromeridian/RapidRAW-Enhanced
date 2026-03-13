export const generatePaletteFromImage = (imageUrl: string) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      const MAX_DIM = 720;
      let width = img.width;
      let height = img.height;

      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }

      width = Math.max(1, width);
      height = Math.max(1, height);

      const canvas: HTMLCanvasElement = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject('No canvas context');

      canvas.width = width;
      canvas.height = height;

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height).data;
      if (!imageData) return reject('No image data');

      let bestAccentCandidate = {
        score: -Infinity,
        color: { r: 210, g: 215, b: 220 },
      };

      const MIN_LIGHTNESS = 0.2;
      const MAX_LIGHTNESS = 0.9;
      const MIN_SATURATION = 0.15;

      const totalPixels = width * height;
      const pixelStep = Math.max(1, Math.floor(totalPixels / 2000));
      const dataStep = pixelStep * 4;

      for (let i = 0; i < imageData.length; i += dataStep) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 510;

        if (l >= MIN_LIGHTNESS && l <= MAX_LIGHTNESS) {
          const s = max === min ? 0 : l > 0.5 ? (max - min) / (510 - max - min) : (max - min) / (max + min);

          if (s >= MIN_SATURATION) {
            const lightnessPenalty = Math.abs(l - 0.75) * 1.5;
            const score = s - lightnessPenalty;

            if (score > bestAccentCandidate.score) {
              bestAccentCandidate = { score, color: { r, g, b } };
            }
          }
        }
      }

      const accentColor = bestAccentCandidate.color;
      const toRgbSpace = (c: any) => `${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)}`;

      resolve({
        '--color-accent': toRgbSpace(accentColor),
        '--color-hover-color': toRgbSpace(accentColor),
      });
    };

    img.onerror = (err) => {
      console.error('Failed to load image for palette generation:', err);
      reject(err);
    };

    img.src = imageUrl;
  });
};
