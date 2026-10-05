import { describe, expect, it } from 'vitest';
import {
  MAX_PROFILE_IMAGE_BYTES,
  validateProfileImage,
} from '@/utils/images/profileImage';

function createWebp(width: number, height: number, withImagePayload = true) {
  const vp8x = new Uint8Array(18);
  vp8x.set([0x56, 0x50, 0x38, 0x58], 0);
  new DataView(vp8x.buffer).setUint32(4, 10, true);
  vp8x[12] = (width - 1) & 0xff;
  vp8x[13] = ((width - 1) >> 8) & 0xff;
  vp8x[14] = ((width - 1) >> 16) & 0xff;
  vp8x[15] = (height - 1) & 0xff;
  vp8x[16] = ((height - 1) >> 8) & 0xff;
  vp8x[17] = ((height - 1) >> 16) & 0xff;

  const vp8l = withImagePayload ? new Uint8Array(14) : new Uint8Array();
  if (withImagePayload) {
    vp8l.set([0x56, 0x50, 0x38, 0x4c], 0);
    new DataView(vp8l.buffer).setUint32(4, 5, true);
    vp8l[8] = 0x2f;
    vp8l[9] = (width - 1) & 0xff;
    vp8l[10] = (((width - 1) >> 8) & 0x3f) | (((height - 1) & 0x03) << 6);
    vp8l[11] = (height - 1) >> 2;
  }

  const bytes = new Uint8Array(12 + vp8x.length + vp8l.length);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set(vp8x, 12);
  bytes.set(vp8l, 12 + vp8x.length);
  return bytes;
}

describe('validateProfileImage', () => {
  it('accepts a 200 by 200 WebP image', () => {
    expect(validateProfileImage(createWebp(200, 200))).toEqual({ ok: true });
  });

  it('rejects images that are not square 200 by 200 pixels', () => {
    expect(validateProfileImage(createWebp(300, 200))).toMatchObject({
      ok: false,
      code: 'INVALID_IMAGE_DIMENSIONS',
    });
  });

  it('rejects a WebP header with no image payload', () => {
    expect(validateProfileImage(createWebp(200, 200, false))).toMatchObject({
      ok: false,
      code: 'INVALID_IMAGE',
    });
  });

  it('rejects malformed RIFF data', () => {
    const bytes = createWebp(200, 200);
    bytes[4] = 0;
    expect(validateProfileImage(bytes)).toMatchObject({
      ok: false,
      code: 'INVALID_IMAGE',
    });
  });

  it('rejects images above the optimized 30 KB limit', () => {
    expect(
      validateProfileImage(new Uint8Array(MAX_PROFILE_IMAGE_BYTES + 1))
    ).toMatchObject({ ok: false, code: 'IMAGE_TOO_LARGE' });
  });
});
