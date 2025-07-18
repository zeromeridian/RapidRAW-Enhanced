export const generatePaletteFromImage = (imageUrl) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const scale = 0.1;
      const width = img.width * scale;
      const height = img.height * scale;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height).data;
      const sampleRate = 20; 
      let bestBgCandidate = { score: Infinity, color: { r: 30, g: 30, b: 30 } };
      let bestAccentCandidate = { score: -1, color: { r: 220, g: 220, b: 220 } };

      for (let i = 0; i < imageData.length; i += 4 * sampleRate) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        
        const r_ = r / 255, g_ = g / 255, b_ = b / 255;
        const max = Math.max(r_, g_, b_), min = Math.min(r_, g_, b_);
        const l = (max + min) / 2;
        const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);

        const bgScore = l + s;
        if (bgScore < bestBgCandidate.score) {
          bestBgCandidate = { score: bgScore, color: { r, g, b, l } };
        }

        if (l > 0.3 && l < 0.8 && s > bestAccentCandidate.score) {
          bestAccentCandidate = { score: s, color: { r, g, b } };
        }
      }

      const bgColor = bestBgCandidate.color;
      const accentColor = bestAccentCandidate.color;

      const textColor = bgColor.l < 0.5 ? '232 234 237' : '20 20 20';
      const textSecondaryColor = bgColor.l < 0.5 ? '158 158 158' : '108 108 108';
      
      const toRgb = (c) => `${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}`;
      const toRgbSpace = (c) => `${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)}`;
      const lighten = (c, factor) => ({ r: Math.min(255, c.r * factor), g: Math.min(255, c.g * factor), b: Math.min(255, c.b * factor) });

      resolve({
        '--color-bg-primary-rgb': toRgb(bgColor),
        '--color-bg-secondary-rgb': toRgb(lighten(bgColor, 1.1)),
        '--color-surface': toRgbSpace(lighten(bgColor, 0.95)),
        '--color-card-active': toRgbSpace(lighten(bgColor, 1.2)),
        '--color-text-primary': textColor,
        '--color-text-secondary': textSecondaryColor,
        '--color-accent': toRgbSpace(accentColor),
        '--color-border-color': toRgbSpace(lighten(bgColor, 1.4)),
        '--color-hover-color': toRgbSpace(accentColor),
        '--color-button-text': bgColor.l < 0.5 ? '255 255 255' : '0 0 0',
      });
    };

    img.onerror = (err) => {
      console.error("Failed to load image for palette generation:", err);
      reject(err);
    };
  });
};