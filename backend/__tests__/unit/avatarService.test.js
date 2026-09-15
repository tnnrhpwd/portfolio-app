/**
 * avatarService.test.js — the 96px avatar built from a stored profile picture.
 *
 * `sharp` is NOT mocked: the whole point of this module is that it produces a
 * small, square, decodable image, and a fake would only prove that the call was
 * made. The source pictures are generated here rather than checked in, so the
 * test also stays honest about what the client actually stores (a 512px data URL).
 */

const sharp = require('sharp');
const {
  AVATAR_PX,
  buildAvatar,
  etagFor,
  _resetAvatarCache,
  _avatarCacheSize,
} = require('../../services/avatarService');

/** A data URL shaped exactly like the one `ProfilePictureEditor` produces. */
async function pictureDataUrl({ size = 512, rgb = { r: 20, g: 120, b: 200 } } = {}) {
    const buffer = await sharp({
        create: { width: size, height: size, channels: 3, background: rgb },
    }).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

beforeEach(() => _resetAvatarCache());

describe('etagFor', () => {
    test('is stable for the same picture and different for another', async () => {
        const a = await pictureDataUrl();
        const b = await pictureDataUrl({ rgb: { r: 200, g: 20, b: 20 } });
        expect(etagFor(a)).toBe(etagFor(a));
        expect(etagFor(a)).not.toBe(etagFor(b));
    });

    test('a missing or empty picture has an empty etag, which is still an answer', () => {
        expect(etagFor(undefined)).toBe('');
        expect(etagFor(null)).toBe('');
        expect(etagFor('')).toBe('');
    });
});

describe('buildAvatar', () => {
    test('returns a decodable square JPEG of the target size', async () => {
        const source = await pictureDataUrl();
        const avatar = await buildAvatar(source);

        expect(avatar.src.startsWith('data:image/jpeg;base64,')).toBe(true);
        expect(avatar.etag).toBe(etagFor(source));

        const decoded = Buffer.from(avatar.src.split(',')[1], 'base64');
        const meta = await sharp(decoded).metadata();
        expect(meta.format).toBe('jpeg');
        expect(meta.width).toBe(AVATAR_PX);
        expect(meta.height).toBe(AVATAR_PX);
    });

    test('is far smaller than the stored picture', async () => {
        const source = await pictureDataUrl();
        const avatar = await buildAvatar(source);
        // The stored 512px q85 picture is tens of KB; the avatar should be a
        // fraction of it, since that is the entire reason this module exists.
        expect(avatar.src.length).toBeLessThan(source.length / 4);
    });

    test('squares a non-square source rather than distorting it', async () => {
        const wide = await sharp({
            create: { width: 400, height: 100, channels: 3, background: { r: 10, g: 200, b: 120 } },
        }).jpeg().toBuffer();
        const avatar = await buildAvatar(`data:image/jpeg;base64,${wide.toString('base64')}`);

        const meta = await sharp(Buffer.from(avatar.src.split(',')[1], 'base64')).metadata();
        expect(meta.width).toBe(AVATAR_PX);
        expect(meta.height).toBe(AVATAR_PX);
    });

    test('encodes each distinct picture once', async () => {
        const source = await pictureDataUrl();
        await buildAvatar(source);
        const afterFirst = _avatarCacheSize();
        await buildAvatar(source);
        await buildAvatar(source);
        expect(_avatarCacheSize()).toBe(afterFirst);
    });

    test('returns null for anything unusable instead of throwing', async () => {
        // One corrupt picture must not fail a whole contact list.
        expect(await buildAvatar(undefined)).toBeNull();
        expect(await buildAvatar('')).toBeNull();
        expect(await buildAvatar('https://example.com/me.jpg')).toBeNull();
        expect(await buildAvatar('data:image/jpeg;base64,not-actually-an-image')).toBeNull();
        expect(await buildAvatar('data:image/jpeg;base64,')).toBeNull();
    });

    test('does not cache a picture it could not decode', async () => {
        await buildAvatar('data:image/jpeg;base64,not-actually-an-image');
        expect(_avatarCacheSize()).toBe(0);
    });

    test('keeps the cache bounded', async () => {
        // Each source must be a DECODABLE image with a distinct hash, so generate
        // tiny ones rather than distinct strings.
        for (let i = 0; i < 405; i += 1) {
            const buffer = await sharp({
                create: { width: 8, height: 8, channels: 3, background: { r: i % 256, g: 7, b: 11 } },
            }).png().toBuffer();
            await buildAvatar(`data:image/png;base64,${buffer.toString('base64')}`);
        }
        expect(_avatarCacheSize()).toBeLessThanOrEqual(400);
    }, 30000);
});
