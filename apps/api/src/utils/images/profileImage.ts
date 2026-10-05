export const MAX_PROFILE_IMAGE_BYTES = 30 * 1024;
export const MAX_PROFILE_IMAGE_REQUEST_BYTES = 8 * 1024 * 1024 + 64 * 1024;
export const PROFILE_IMAGE_DIMENSION = 200;

export type ProfileImageValidation =
  | { ok: true }
  | { ok: false; code: string; message: string };

function readWebpDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} | null {
  if (
    bytes.byteLength < 20 ||
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.byteLength - 8) return null;

  let offset = 12;
  let dimensions: { width: number; height: number } | null = null;
  let hasImagePayload = false;
  while (offset + 8 <= bytes.byteLength) {
    const chunkType = String.fromCharCode(
      bytes[offset]!,
      bytes[offset + 1]!,
      bytes[offset + 2]!,
      bytes[offset + 3]!
    );
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkSize;
    if (chunkEnd > bytes.byteLength) return null;

    if (chunkType === 'VP8X' && chunkSize >= 10) {
      const width =
        1 +
        bytes[dataOffset + 4]! +
        (bytes[dataOffset + 5]! << 8) +
        (bytes[dataOffset + 6]! << 16);
      const height =
        1 +
        bytes[dataOffset + 7]! +
        (bytes[dataOffset + 8]! << 8) +
        (bytes[dataOffset + 9]! << 16);
      dimensions = { width, height };
    }

    if (
      chunkType === 'VP8L' &&
      chunkSize >= 5 &&
      bytes[dataOffset] === 0x2f
    ) {
      dimensions ??= {
        width:
          1 + bytes[dataOffset + 1]! + ((bytes[dataOffset + 2]! & 0x3f) << 8),
        height:
          1 +
          ((bytes[dataOffset + 2]! >> 6) & 0x03) +
          (bytes[dataOffset + 3]! << 2) +
          ((bytes[dataOffset + 4]! & 0x0f) << 10),
      };
      hasImagePayload = true;
    }

    if (
      chunkType === 'VP8 ' &&
      chunkSize >= 10 &&
      bytes[dataOffset + 3] === 0x9d &&
      bytes[dataOffset + 4] === 0x01 &&
      bytes[dataOffset + 5] === 0x2a
    ) {
      dimensions ??= {
        width:
          (bytes[dataOffset + 6]! | (bytes[dataOffset + 7]! << 8)) & 0x3fff,
        height:
          (bytes[dataOffset + 8]! | (bytes[dataOffset + 9]! << 8)) & 0x3fff,
      };
      hasImagePayload = true;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  return offset === bytes.byteLength && hasImagePayload ? dimensions : null;
}

export function validateProfileImage(
  bytes: Uint8Array
): ProfileImageValidation {
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'EMPTY_FILE', message: 'The image file is empty.' };
  }
  if (bytes.byteLength > MAX_PROFILE_IMAGE_BYTES) {
    return {
      ok: false,
      code: 'IMAGE_TOO_LARGE',
      message: 'The optimized image must be 30 KB or smaller.',
    };
  }

  const dimensions = readWebpDimensions(bytes);
  if (!dimensions) {
    return {
      ok: false,
      code: 'INVALID_IMAGE',
      message: 'The uploaded file is not a valid WebP image.',
    };
  }
  if (
    dimensions.width !== PROFILE_IMAGE_DIMENSION ||
    dimensions.height !== PROFILE_IMAGE_DIMENSION
  ) {
    return {
      ok: false,
      code: 'INVALID_IMAGE_DIMENSIONS',
      message: 'The profile image must be exactly 200 × 200 pixels.',
    };
  }

  return { ok: true };
}
