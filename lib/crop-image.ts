export type CropArea = { x: number; y: number; width: number; height: number };

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error('This photo could not be read. Please choose another image.'));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error('This photo could not be loaded. Please choose it again.'));
    image.src = src;
  });
}

/** The area uses react-easy-crop's pixels within the rotated image's bounding box. */
export async function createCroppedImage(src: string, area: CropArea, rotation = 0): Promise<Blob> {
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) {
    throw new Error('Rotate the photo in 90° steps.');
  }
  if (!Object.values(area).every(Number.isFinite) || area.width <= 0 || area.height <= 0) {
    throw new Error('Choose a crop before saving the photo.');
  }

  const image = await loadImage(src);
  const angle = ((rotation % 360) + 360) % 360;
  const swapsDimensions = angle === 90 || angle === 270;
  const rotatedWidth = swapsDimensions ? image.naturalHeight : image.naturalWidth;
  const rotatedHeight = swapsDimensions ? image.naturalWidth : image.naturalHeight;
  if (area.x < 0 || area.y < 0 || area.x + area.width > rotatedWidth || area.y + area.height > rotatedHeight) {
    throw new Error('The selected crop is outside the photo. Please reset the view.');
  }

  const scale = Math.min(1, 2000 / Math.max(area.width, area.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Photo editing is unavailable in this browser.');

  // JPEG has no transparency. Give transparent source pixels a predictable backing.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  // Clip and rotate directly into the bounded output instead of allocating a full-size stage.
  context.scale(canvas.width / area.width, canvas.height / area.height);
  context.translate(rotatedWidth / 2 - area.x, rotatedHeight / 2 - area.y);
  context.rotate(angle * Math.PI / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Could not prepare this photo. Please try again.')),
      'image/jpeg',
      .9,
    );
  });
}
