import sharp from 'sharp';
import { DomainError } from '../domain/tree.js';
import { JOURNAL_MEDIA_LIMITS as L } from '../shared/journal-media-contracts.js';
export interface NormalizedJournalImage {
  bytes: Buffer;
  width: number;
  height: number;
}
export async function normalizeJournalImage(
  source: Buffer,
): Promise<NormalizedJournalImage> {
  const png = source
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = source[0] === 255 && source[1] === 216 && source[2] === 255;
  const webp =
    source.toString('ascii', 0, 4) === 'RIFF' &&
    source.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw invalidImage();
  // libvips may expose APNG as a static PNG. Reject animation controls in the
  // source container as well as the decoder's pages count (also single-frame
  // animation containers). Skip payloads by bounded chunk lengths.
  if (png || webp) {
    for (let offset = png ? 8 : 12; offset < source.length;) {
      if (offset + (png ? 12 : 8) > source.length) throw invalidImage();
      const length = png
        ? source.readUInt32BE(offset)
        : source.readUInt32LE(offset + 4);
      const type = source.toString(
        'ascii',
        offset + (png ? 4 : 0),
        offset + (png ? 8 : 4),
      );
      if (['acTL', 'fcTL', 'fdAT', 'ANIM', 'ANMF'].includes(type))
        throw invalidImage();
      const next = offset + length + (png ? 12 : 8 + (length % 2));
      if (next > source.length) throw invalidImage();
      offset = next;
    }
  }
  try {
    const image = sharp(source, {
      failOn: 'warning',
      limitInputPixels: L.imagePixels,
      animated: true,
    }).timeout({ seconds: L.decodeTimeoutSeconds });
    try {
      const metadata = await image.metadata();
      if (
        !['png', 'jpeg', 'webp'].includes(metadata.format ?? '') ||
        (metadata.pages ?? 1) !== 1 ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > L.imageDimension ||
        metadata.height > L.imageDimension ||
        metadata.width * metadata.height > L.imagePixels
      )
        throw invalidImage();
      const { data, info } = await image
        .rotate()
        .webp({ lossless: true })
        .toBuffer({ resolveWithObject: true });
      if (data.length > L.storedBytes)
        throw new DomainError(
          'MEDIA_TOO_LARGE',
          'Изображение превышает 25 MiB.',
          413,
        );
      return { bytes: data, width: info.width, height: info.height };
    } finally {
      image.destroy();
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw invalidImage();
  }
}
function invalidImage() {
  return new DomainError(
    'MEDIA_IMAGE_INVALID',
    'Требуется корректное статическое изображение PNG, JPEG или WebP.',
    415,
  );
}
