/**
 * bedrockImageService.test.js — unit tests for the Bedrock text-to-image
 * adapter (backend/services/bedrockImageService.js).
 *
 * Mirrors bedrockService.test.js: the real @aws-sdk/client-bedrock-runtime
 * ships an ESM build this repo's Jest config can't parse, so the package is
 * mocked here to keep the test fast and free of real AWS credentials/network.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    InvokeModelCommand: jest.fn().mockImplementation((input) => ({ input })),
    ConverseCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const { InvokeModelCommand, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const {
    IMAGE_MODELS,
    DEFAULT_IMAGE_MODEL_ID,
    generateImage,
} = require('../../services/bedrockImageService');

describe('bedrockImageService — request/response shape translation', () => {
    beforeEach(() => {
        mockSend.mockReset();
        InvokeModelCommand.mockClear();
        ConverseCommand.mockClear();
    });

    it('builds the correct InvokeModel body for Stable Diffusion 3.5 Large', async () => {
        mockSend.mockResolvedValue({
            body: Buffer.from(JSON.stringify({ images: ['aGVsbG8='], seed: 42 })),
        });

        const result = await generateImage({
            prompt: 'a neon cat in a synthwave city',
            modelId: 'stability.sd3-5-large-v1:0',
            aspectRatio: '16:9',
            numberOfImages: 1,
            seed: 42,
        });

        expect(InvokeModelCommand).toHaveBeenCalledTimes(1);
        const input = InvokeModelCommand.mock.calls[0][0];
        expect(input.modelId).toBe('stability.sd3-5-large-v1:0');
        expect(input.contentType).toBe('application/json');
        const body = JSON.parse(input.body);
        expect(body).toMatchObject({
            prompt: 'a neon cat in a synthwave city',
            aspect_ratio: '16:9',
            output_format: 'png',
            mode: 'text-to-image',
            seed: 42,
        });

        expect(result.images).toEqual([{ mimeType: 'image/png', base64: 'aGVsbG8=' }]);
        expect(result.model).toBe('stability.sd3-5-large-v1:0');
        expect(result.provider).toBe('stability');
    });

    it('includes negative_prompt and omits mode for Stable Image Core', async () => {
        mockSend.mockResolvedValue({
            body: Buffer.from(JSON.stringify({ images: ['cG5n'], seed: 7 })),
        });

        await generateImage({
            prompt: 'a cozy cabin',
            modelId: 'stability.stable-image-core-v1:1',
            aspectRatio: '1:1',
            seed: 7,
            negativePrompt: 'blurry, low quality',
        });

        const body = JSON.parse(InvokeModelCommand.mock.calls[0][0].body);
        expect(body.negative_prompt).toBe('blurry, low quality');
        expect(body.mode).toBeUndefined();
    });

    it('parses Gemini image content blocks out of a Converse response', async () => {
        const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        mockSend.mockResolvedValue({
            output: {
                message: {
                    content: [
                        { text: 'Here is your image:' },
                        { image: { format: 'png', source: { bytes: pngBytes } } },
                    ],
                },
            },
        });

        const result = await generateImage({
            prompt: 'a nano banana in a fancy restaurant',
            modelId: 'gemini-2.5-flash-image',
            aspectRatio: '1:1',
            numberOfImages: 1,
        });

        expect(ConverseCommand).toHaveBeenCalledTimes(1);
        expect(result.images).toEqual([
            { mimeType: 'image/png', base64: pngBytes.toString('base64') },
        ]);
        expect(result.provider).toBe('gemini');
    });

    it('rejects unsupported models', async () => {
        await expect(generateImage({
            prompt: 'test',
            modelId: 'bogus-model',
            aspectRatio: '1:1',
        })).rejects.toThrow(/Unsupported image model/);
    });

    it('rejects unsupported aspect ratios for a given model', async () => {
        await expect(generateImage({
            prompt: 'test',
            modelId: 'stability.sd3-5-large-v1:0',
            aspectRatio: '999:1',
        })).rejects.toThrow(/Unsupported aspect ratio/);
    });

    it('exposes a catalog with a valid default model', () => {
        expect(IMAGE_MODELS[DEFAULT_IMAGE_MODEL_ID]).toBeDefined();
        for (const [id, info] of Object.entries(IMAGE_MODELS)) {
            expect(info.provider).toBeDefined();
            expect(info.label).toBeDefined();
            expect(info.aspectRatios).toContain('1:1');
            expect(id).toBeTruthy();
        }
    });
});
