/**
 * fileSignature.js — content sniffing for the post-upload check on the
 * presigned S3 path.
 *
 * The gap this closes: `/upload-url` validates what the client *claims* (the
 * filename extension, the declared content type, the declared size), and then
 * the bytes go client → S3 directly via the presigned URL. The server never
 * sees them, so an upload can declare `image/png` and contain anything at all.
 * After confirm we read the first few hundred bytes and compare what the
 * content actually looks like against what it claims to be.
 *
 * Design rule — **contradiction only**:
 *   - reject a file whose *known* signature disagrees with its extension;
 *   - accept everything else, including content that can't be identified.
 *
 * That asymmetry is deliberate. A check that rejected "unrecognised" content
 * would break legitimate uploads (plain text has no signature; a PDF may carry
 * a leading BOM or whitespace), and failing a real user's file is a worse
 * outcome than the marginal security gain. The residual gap — content with no
 * known signature is accepted — is documented here rather than papered over.
 *
 * Everything in this module is pure, so the rules above are directly testable.
 * `UPLOAD_SIGNATURE_CHECK=false` is the operator kill-switch.
 */

/** How many bytes to read for the check. Enough for the deepest signature (webp). */
const SIGNATURE_HEAD_BYTES = 512;

/**
 * Known content signatures, most distinctive first. `offset` is where the
 * magic number starts (webp is `RIFF....WEBP`, so its marker sits at byte 8).
 */
const SIGNATURES = Object.freeze([
    { family: 'png', offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
    { family: 'jpeg', offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
    { family: 'gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // "GIF8"
    { family: 'pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // "%PDF"
    { family: 'webp', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
    { family: 'zip', offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }, // docx/xlsx are zips
    { family: 'mz', offset: 0, bytes: [0x4D, 0x5A] },               // Windows PE (exe/dll)
    { family: 'elf', offset: 0, bytes: [0x7F, 0x45, 0x4C, 0x46] },  // ELF executable
]);

/**
 * extension → the signature family its content is expected to have. Kept in
 * step with `EXTENSION_CONTENT_TYPES` in constants/upload.js.
 */
const EXTENSION_FAMILIES = Object.freeze({
    png: 'png',
    jpg: 'jpeg',
    jpeg: 'jpeg',
    gif: 'gif',
    webp: 'webp',
    pdf: 'pdf',
    docx: 'zip',
    xlsx: 'zip',
});

/**
 * Extensions that are legitimately plain text. They have no signature to match,
 * so for these the rule is the inverse: a *known binary* head is the
 * contradiction. Listed separately from EXTENSION_FAMILIES because "no
 * signature expected" (a real rule) is not the same as "no rule".
 */
const TEXT_EXTENSIONS = Object.freeze(['txt', 'csv', 'json']);

/** Is the check enabled? Off only when explicitly disabled (matches USE_CLOUDFRONT style). */
function isSignatureCheckEnabled() {
    return process.env.UPLOAD_SIGNATURE_CHECK !== 'false';
}

/**
 * Normalise a head into a Buffer. Accepts Buffer / Uint8Array / string, since
 * the S3 SDK may hand back either byte container.
 * @returns {Buffer|null}
 */
function toBuffer(head) {
    if (head === null || head === undefined) return null;
    if (Buffer.isBuffer(head)) return head;
    if (head instanceof Uint8Array) return Buffer.from(head);
    if (typeof head === 'string') return Buffer.from(head, 'binary');
    return null;
}

/** The lowercase extension of a filename or S3 key, without the dot. */
function extensionOf(nameOrKey) {
    const name = String(nameOrKey || '');
    const base = name.split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot + 1).toLowerCase();
}

function matchesAt(buf, signature) {
    const { offset, bytes } = signature;
    if (buf.length < offset + bytes.length) return false;
    return bytes.every((byte, index) => buf[offset + index] === byte);
}

/**
 * Identify the content family from its leading bytes.
 * @param {Buffer|Uint8Array|string} head
 * @returns {string|null} family name, or null when nothing is recognised
 */
function detectSignature(head) {
    const buf = toBuffer(head);
    if (!buf || buf.length === 0) return null;

    const match = SIGNATURES.find((signature) => matchesAt(buf, signature));
    return match ? match.family : null;
}

/**
 * Does the content contradict the extension it was stored under?
 *
 * @param {Buffer|Uint8Array|string} head leading bytes of the stored object
 * @param {string} extension extension to check against (with or without a dot)
 * @returns {{ ok: boolean, detected: string|null, reason?: string, unverified?: boolean }}
 */
function verifySignature(head, extension) {
    const buf = toBuffer(head);
    if (!buf || buf.length === 0) {
        return { ok: true, detected: null, reason: 'no content to inspect' };
    }

    const detected = detectSignature(buf);
    const ext = String(extension || '').replace(/^\./, '').toLowerCase();

    // Nothing was claimed, so there is nothing to contradict.
    if (!ext) return { ok: true, detected };

    const expected = EXTENSION_FAMILIES[ext];

    if (expected) {
        if (detected === expected) return { ok: true, detected };

        if (!detected) {
            // Unrecognised, not contradicted: let it through, but say so, so a
            // run of these in the logs is visible rather than invisible.
            return { ok: true, detected: null, unverified: true };
        }

        return {
            ok: false,
            detected,
            reason: `content looks like a ${detected} file, not ${ext}`,
        };
    }

    // A text extension has no signature to match, so a *positive* binary
    // signature is the only thing that can contradict it. (UTF-16 text has no
    // signature, so it is not caught here — deliberately: rejecting a real
    // Notepad "Unicode" save would be a worse outcome than the marginal gain.)
    if (TEXT_EXTENSIONS.includes(ext)) {
        if (detected) {
            return {
                ok: false,
                detected,
                reason: `content looks like a binary ${detected} file, not ${ext}`,
            };
        }
        return { ok: true, detected: null };
    }

    // No rule for this extension: nothing to compare against, so nothing to
    // contradict. (Unreachable from the upload path today — validateFile only
    // admits extensions from EXTENSION_CONTENT_TYPES — but a check that rejects
    // files it cannot judge is exactly what this module avoids.)
    return { ok: true, detected };
}

module.exports = {
    SIGNATURE_HEAD_BYTES,
    SIGNATURES,
    EXTENSION_FAMILIES,
    TEXT_EXTENSIONS,
    isSignatureCheckEnabled,
    extensionOf,
    detectSignature,
    verifySignature,
};
