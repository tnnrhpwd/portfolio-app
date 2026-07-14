/**
 * webcam.js — Webcam frame capture tool for the agent.
 *
 * Separate from the eye-tracking system: this captures a JPEG from a webcam
 * index (default 0) via Python subprocess and optionally runs a multimodal
 * vision description via the LLM.
 *
 * Agent use cases:
 *   - "What is the user doing?" (face/body description)
 *   - "Is the user present at the desk?"
 *   - "What is shown on the physical whiteboard/screen?"
 *
 * Privacy: frames are processed in RAM and never persisted to disk or cloud
 * unless the agent explicitly calls fs_write or s3_upload.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CAPTURE_TIMEOUT_MS = 10_000;
const MAX_DESCRIBE_CHARS = 800;

function _resolvePython() {
    const venvBase = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'CSimple', 'venv'
    );
    const win = path.join(venvBase, 'Scripts', 'python.exe');
    if (fs.existsSync(win)) return win;
    const nix = path.join(venvBase, 'bin', 'python3');
    if (fs.existsSync(nix)) return nix;
    return 'python';
}

/**
 * Capture one frame from a webcam using a minimal inline Python script.
 * Returns base64 JPEG bytes.
 */
async function captureWebcamFrame({ deviceIndex = 0, width = 640, height = 480, quality = 80 } = {}) {
    const python = _resolvePython();
    const script = `
import sys, base64, json
try:
    import cv2
    cap = cv2.VideoCapture(${parseInt(deviceIndex, 10)})
    if not cap.isOpened():
        print(json.dumps({"error": "cannot open camera ${parseInt(deviceIndex, 10)}"}))
        sys.exit(1)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, ${parseInt(width, 10)})
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, ${parseInt(height, 10)})
    import time; time.sleep(0.2)  # warm-up
    ok, frame = cap.read()
    cap.release()
    if not ok:
        print(json.dumps({"error": "failed to read frame"}))
        sys.exit(1)
    import numpy as np
    ok2, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, ${parseInt(quality, 10)}])
    if not ok2:
        print(json.dumps({"error": "JPEG encode failed"}))
        sys.exit(1)
    b64 = base64.b64encode(buf.tobytes()).decode()
    h, w = frame.shape[:2]
    print(json.dumps({"base64": b64, "width": w, "height": h, "device": ${parseInt(deviceIndex, 10)}}))
except ImportError as e:
    print(json.dumps({"error": f"opencv-python not installed: {e}"}))
`.trim();

    return new Promise((resolve, reject) => {
        const proc = spawn(python, ['-c', script], { windowsHide: true, timeout: CAPTURE_TIMEOUT_MS });
        let out = '';
        let err = '';
        proc.stdout.on('data', d => { out += d.toString('utf-8'); });
        proc.stderr.on('data', d => { err += d.toString('utf-8'); });
        proc.on('close', code => {
            try {
                const result = JSON.parse(out.trim());
                if (result.error) return reject(new Error(result.error));
                resolve(result);
            } catch {
                reject(new Error(err.trim() || `python exited with code ${code}`));
            }
        });
        proc.on('error', reject);
    });
}

// ─── Vision description (optional) ───────────────────────────────────────────

async function _describeFrame(base64Jpeg, query, llmClient) {
    if (!llmClient) {
        try {
            const { GitHubModelsService } = require('../../github-models-service');
            llmClient = new GitHubModelsService();
            const cfgPath = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources', 'settings.json');
            if (fs.existsSync(cfgPath)) {
                const s = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
                if (s.githubToken) llmClient.setToken(s.githubToken);
            }
        } catch (e) {
            throw new Error('No LLM client for webcam description: ' + e.message);
        }
    }
    const response = await llmClient.chat({
        model: 'openai/gpt-4o-mini',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: query || 'Describe what you see in this webcam frame briefly (2-3 sentences). Focus on the person and their activity.' },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Jpeg}`, detail: 'low' } },
            ],
        }],
        max_tokens: 256,
    });
    return (response?.choices?.[0]?.message?.content || '').trim().slice(0, MAX_DESCRIBE_CHARS);
}

// ─── Agent tool ───────────────────────────────────────────────────────────────

const webcamCapture = {
    name: 'webcam_capture',
    category: 'safe-read',
    description:
        'Capture a frame from the user\'s webcam. Optionally describe what is visible using vision AI. ' +
        'Use to understand the user\'s physical environment or confirm presence. ' +
        'Frames are NEVER stored — they exist only in this response.',
    parameters: {
        type: 'object',
        properties: {
            device_index: { type: 'integer', description: 'Camera device index (default 0).' },
            width: { type: 'integer', description: 'Capture width in pixels (default 640).' },
            height: { type: 'integer', description: 'Capture height in pixels (default 480).' },
            describe: {
                type: 'boolean',
                description: 'If true, run vision AI to describe the frame (adds ~1s latency).',
            },
            describe_query: {
                type: 'string',
                description: 'Custom question to ask the vision AI about the frame.',
            },
            return_image: {
                type: 'boolean',
                description: 'If true (default false), include base64 JPEG in response. Large payload.',
            },
        },
    },
    async run(args, ctx) {
        const deviceIndex = Math.max(0, Math.min(10, Number(args?.device_index ?? 0)));
        const width = Math.min(1920, Math.max(160, Number(args?.width) || 640));
        const height = Math.min(1080, Math.max(120, Number(args?.height) || 480));

        ctx?.log?.(`[webcam] capturing device=${deviceIndex} ${width}x${height}`);
        const frame = await captureWebcamFrame({ deviceIndex, width, height, quality: 75 });

        const result = {
            device: frame.device,
            width: frame.width,
            height: frame.height,
            bytes: Math.round(frame.base64.length * 0.75),
        };

        if (args?.return_image) {
            result.base64 = frame.base64;
        }

        if (args?.describe) {
            ctx?.log?.('[webcam] running vision description');
            result.description = await _describeFrame(frame.base64, args?.describe_query || null, ctx?.llm);
        }

        return result;
    },
    async dryRun(_args) {
        return { device: 0, width: 640, height: 480, bytes: 0, dry: true };
    },
};

module.exports = { webcamCapture, captureWebcamFrame };
