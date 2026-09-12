/**
 * fileSignature.test.js — the content-vs-extension rules used by the
 * upload-confirm gate (backend/utils/fileSignature.js).
 *
 * The whole value of this module rests on an asymmetry that is easy to destroy
 * by "improving" it:
 *
 *   - a *contradiction* is rejected (a .png whose bytes are a PDF or a ZIP);
 *   - everything else is accepted, including content with no known signature.
 *
 * So these tests are as much about what must NOT be rejected as about what
 * must. A future edit that starts rejecting unrecognised content would fail
 * legitimate uploads — the tests below pin that open.
 */

const {
    SIGNATURE_HEAD_BYTES,
    isSignatureCheckEnabled,
    extensionOf,
    detectSignature,
    verifySignature,
} = require('../../utils/fileSignature');

const bytes = (...values) => Buffer.from(values);

const PNG = bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01);
const JPEG = bytes(0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10);
const GIF = Buffer.from('GIF89a', 'binary');
const PDF = Buffer.from('%PDF-1.7\n', 'binary');
const ZIP = bytes(0x50, 0x4B, 0x03, 0x04, 0x14, 0x00); // docx/xlsx
const MZ = Buffer.from('MZ\x90\x00', 'binary');
const ELF = bytes(0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01);
const TEXT = Buffer.from('date,amount\n2026-01-01,10.50\n', 'utf8');
/** RIFF container with the WEBP marker at offset 8. */
const WEBP = Buffer.concat([
    Buffer.from('RIFF', 'binary'), bytes(0x24, 0x00, 0x00, 0x00), Buffer.from('WEBP', 'binary'),
]);

describe('detectSignature', () => {
    it.each([
        ['png', PNG],
        ['jpeg', JPEG],
        ['gif', GIF],
        ['pdf', PDF],
        ['webp', WEBP],
        ['zip', ZIP],
        ['mz', MZ],
        ['elf', ELF],
    ])('identifies %s content', (family, head) => {
        expect(detectSignature(head)).toBe(family);
    });

    it('returns null for plain text', () => {
        expect(detectSignature(TEXT)).toBeNull();
    });

    it('returns null for nothing to inspect', () => {
        expect(detectSignature(Buffer.alloc(0))).toBeNull();
        expect(detectSignature(null)).toBeNull();
        expect(detectSignature(undefined)).toBeNull();
    });

    it('accepts a Uint8Array, as the S3 SDK may return one', () => {
        expect(detectSignature(new Uint8Array(PNG))).toBe('png');
    });

    it('does not treat a WEBP marker at the wrong offset as webp', () => {
        expect(detectSignature(Buffer.from('xWEBPxxxxx', 'binary'))).toBeNull();
    });
});

describe('verifySignature — contradictions are rejected', () => {
    it('rejects a .png containing a PDF', () => {
        const verdict = verifySignature(PDF, 'png');

        expect(verdict.ok).toBe(false);
        expect(verdict.detected).toBe('pdf');
        expect(verdict.reason).toContain('pdf');
    });

    it('rejects a .png containing an executable', () => {
        expect(verifySignature(MZ, 'png').ok).toBe(false);
        expect(verifySignature(ELF, 'png').ok).toBe(false);
    });

    it('rejects a .pdf containing a ZIP', () => {
        expect(verifySignature(ZIP, 'pdf').ok).toBe(false);
    });

    it('rejects a .docx containing an image (zip family mismatch)', () => {
        expect(verifySignature(PNG, 'docx').ok).toBe(false);
    });

    it('rejects a text file whose content is a known binary', () => {
        expect(verifySignature(PNG, 'txt').ok).toBe(false);
        expect(verifySignature(ZIP, 'csv').ok).toBe(false);
        expect(verifySignature(MZ, 'json').ok).toBe(false);
    });

    it('rejects through a dotted extension and mixed case', () => {
        expect(verifySignature(PDF, '.PNG').ok).toBe(false);
    });
});

describe('verifySignature — legitimate uploads are accepted', () => {
    it.each([
        ['png', PNG],
        ['jpg', JPEG],
        ['jpeg', JPEG],
        ['gif', GIF],
        ['webp', WEBP],
        ['pdf', PDF],
        ['docx', ZIP],
        ['xlsx', ZIP],
    ])('accepts real %s content', (extension, head) => {
        expect(verifySignature(head, extension).ok).toBe(true);
    });

    it('accepts genuine text as txt/csv/json', () => {
        expect(verifySignature(TEXT, 'txt').ok).toBe(true);
        expect(verifySignature(TEXT, 'csv').ok).toBe(true);
        expect(verifySignature(Buffer.from('{"a":1}', 'utf8'), 'json').ok).toBe(true);
    });

    it('accepts — but flags as unverified — a .png whose bytes it cannot identify', () => {
        const verdict = verifySignature(Buffer.from('not really a png', 'utf8'), 'png');

        expect(verdict.ok).toBe(true);
        expect(verdict.unverified).toBe(true);
        expect(verdict.detected).toBeNull();
    });

    it('accepts a truncated head that is too short to hold a signature', () => {
        // A zero-byte or one-byte object cannot be contradicted by anything.
        expect(verifySignature(bytes(0x89), 'png')).toMatchObject({ ok: true, unverified: true });
    });

    it('accepts when nothing was declared, or nothing could be read', () => {
        expect(verifySignature(PNG, '').ok).toBe(true);
        expect(verifySignature(PNG, undefined).ok).toBe(true);
        expect(verifySignature(Buffer.alloc(0), 'png').ok).toBe(true);
        expect(verifySignature(null, 'png').ok).toBe(true);
    });

    it('ignores an extension it has no rule for', () => {
        expect(verifySignature(PNG, 'weird').ok).toBe(true);
    });
});

describe('extensionOf', () => {
    it('reads the extension off an S3 key', () => {
        expect(extensionOf('users/u1/general/1699999999_ab12cd34.png')).toBe('png');
    });

    it('lowercases and handles plain names', () => {
        expect(extensionOf('Report.PDF')).toBe('pdf');
        expect(extensionOf('archive.tar.gz')).toBe('gz');
    });

    it('returns empty string when there is no usable extension', () => {
        expect(extensionOf('README')).toBe('');
        expect(extensionOf('.gitignore')).toBe('');
        expect(extensionOf('trailing.')).toBe('');
        expect(extensionOf('')).toBe('');
        expect(extensionOf(undefined)).toBe('');
    });
});

describe('isSignatureCheckEnabled', () => {
    afterEach(() => {
        delete process.env.UPLOAD_SIGNATURE_CHECK;
    });

    it('is on by default', () => {
        expect(isSignatureCheckEnabled()).toBe(true);
    });

    it('is off only when explicitly disabled', () => {
        process.env.UPLOAD_SIGNATURE_CHECK = 'false';
        expect(isSignatureCheckEnabled()).toBe(false);

        process.env.UPLOAD_SIGNATURE_CHECK = 'true';
        expect(isSignatureCheckEnabled()).toBe(true);

        process.env.UPLOAD_SIGNATURE_CHECK = '';
        expect(isSignatureCheckEnabled()).toBe(true);
    });
});

describe('SIGNATURE_HEAD_BYTES', () => {
    it('is deep enough to cover the deepest signature (webp at offset 8)', () => {
        expect(SIGNATURE_HEAD_BYTES).toBeGreaterThan(12);
    });
});
