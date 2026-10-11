'use strict';
(() => {
  const MAX_INPUT_BYTES = 20 * 1024 * 1024;
  const MAX_BYTES = 1024 * 1024;
  const MAX_EDGE = 1536;
  const MAX_INPUT_PIXELS = 60 * 1000 * 1000;
  const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
  const RASTER_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|avif|heic|heif)$/i;
  const BACKUP_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const invalidBackup = () => new Error('백업의 표지 이미지가 올바르지 않습니다.');

  function signature(bytes) {
    const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) return 'image/png';
    if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
    if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
    if (bytes.length >= 16 && ascii(4, 4) === 'ftyp') {
      const brands = [ascii(8, 4)];
      const boxSize = (bytes[0] * 16777216) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
      for (let offset = 16; offset + 4 <= Math.min(bytes.length, boxSize); offset += 4) brands.push(ascii(offset, 4));
      if (brands.some(brand => ['avif', 'avis'].includes(brand))) return 'image/avif';
      if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) return 'image/heic';
      if (brands.some(brand => ['mif1', 'msf1'].includes(brand))) return 'image/heif';
    }
    return '';
  }

  async function identify(blob) {
    return signature(new Uint8Array(await blob.slice(0, 128).arrayBuffer()));
  }

  async function decoded(blob, callback, failure) {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    let timer;
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(failure());
        timer = setTimeout(() => reject(failure()), 15000);
        image.src = url;
      });
      clearTimeout(timer);
      if (!image.naturalWidth || !image.naturalHeight) throw failure();
      return await callback(image);
    } finally {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      image.src = '';
      URL.revokeObjectURL(url);
    }
  }

  function encode(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('표지 이미지를 준비하지 못했습니다. 다른 이미지를 선택해 주세요.')), 'image/jpeg', quality);
    });
  }

  async function prepare(file) {
    if (!(file instanceof Blob) || !file.size) throw new Error('표지 이미지를 선택해 주세요.');
    if (file.size > MAX_INPUT_BYTES) throw new Error('표지 원본은 20 MB까지 선택할 수 있습니다.');
    const type = (file.type || '').toLowerCase();
    const fileName = typeof file.name === 'string' ? file.name : '';
    if (/\.svgz?$/i.test(fileName) || type.includes('svg') ||
        (!RASTER_TYPES.has(type) && !((!type || type === 'application/octet-stream') && RASTER_EXTENSIONS.test(fileName)))) {
      throw new Error('JPG, PNG, WebP, GIF, AVIF 또는 HEIC 이미지를 선택해 주세요.');
    }
    const actualType = await identify(file);
    if (!RASTER_TYPES.has(actualType)) throw new Error('이미지 파일이 아닙니다. JPG 또는 PNG 이미지를 선택해 주세요.');
    const source = file.slice(0, file.size, actualType);
    return decoded(source, async image => {
      if (image.naturalWidth * image.naturalHeight > MAX_INPUT_PIXELS) throw new Error('이미지 해상도가 너무 큽니다. 작은 이미지를 선택해 주세요.');
      const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      let width = Math.max(1, Math.round(image.naturalWidth * scale));
      let height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('이 환경에서 표지를 준비하지 못했습니다. Safari에서 다시 시도해 주세요.');
      try {
        for (let resize = 0; resize < 6; resize++) {
          canvas.width = width;
          canvas.height = height;
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          for (const quality of [0.88, 0.78, 0.68, 0.58]) {
            const blob = await encode(canvas, quality);
            if (blob.size <= MAX_BYTES && blob.type === 'image/jpeg' && await identify(blob) === 'image/jpeg') return { blob, width, height, fileName };
          }
          width = Math.max(1, Math.floor(width * 0.8));
          height = Math.max(1, Math.floor(height * 0.8));
        }
        throw new Error('표지 이미지를 줄이지 못했습니다. 다른 이미지를 선택해 주세요.');
      } finally {
        canvas.width = canvas.height = 1;
      }
    }, () => new Error('이미지를 읽지 못했습니다. JPG 또는 PNG 파일로 다시 선택해 주세요.'));
  }

  async function serialize(value) {
    const blob = value?.blob;
    if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_BYTES || !BACKUP_TYPES.has(blob.type) || await identify(blob) !== blob.type) throw invalidBackup();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('표지 이미지를 백업하지 못했습니다. 다시 시도해 주세요.'));
      reader.readAsDataURL(blob);
    });
  }

  async function restore(dataURL) {
    if (typeof dataURL !== 'string' || dataURL.length > Math.ceil(MAX_BYTES / 3) * 4 + 32) throw invalidBackup();
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataURL);
    if (!match || match[2].length % 4) throw invalidBackup();
    const byteLength = match[2].length / 4 * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    if (!byteLength || byteLength > MAX_BYTES) throw invalidBackup();
    let binary;
    try {
      binary = atob(match[2]);
      if (binary.length !== byteLength || btoa(binary) !== match[2]) throw invalidBackup();
    } catch { throw invalidBackup(); }
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (signature(bytes) !== match[1]) throw invalidBackup();
    const blob = new Blob([bytes], { type: match[1] });
    return decoded(blob, image => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_EDGE * MAX_EDGE) throw invalidBackup();
      return { blob, width, height, fileName: '' };
    }, invalidBackup);
  }

  window.TextviewCoverImage = { prepare, serialize, restore };
})();
