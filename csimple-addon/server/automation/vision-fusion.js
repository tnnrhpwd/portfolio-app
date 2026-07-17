/**
 * Vision + UIA Fusion
 *
 * When the agent needs to click "something" but UIA lookup fails (custom-drawn
 * UI, web canvas, game, image label), this tool falls back to:
 *   1. screen_capture (full or region)
 *   2. multimodal LLM call with the image + the goal description
 *   3. parse coordinates from the LLM response
 *   4. verify by searching the nearest UIA element at those coords
 *   5. either invoke that element (preferred) OR send a synthetic click
 *
 * This is a higher-level tool — it composes existing primitives, so it lives
 * here rather than in tools/ to avoid double-registration.
 */

const screen = require('./tools/screen');
const { uiaInvoke } = require('./tools/uia');
const { spawn } = require('child_process');
const permissions = require('./permissions');
const events = require('./events');

const findVisualTarget = {
    name: 'find_and_click_visual',
    category: 'system',
    description:
        'Locate a UI element visually using a multimodal LLM and click it. ' +
        'Use this ONLY when uia_find returns no match. Provide a precise visual ' +
        'description (e.g. "the blue Submit button at the bottom-right of the form").',
    parameters: {
        type: 'object',
        properties: {
            description: { type: 'string', description: 'Visual description of the target.' },
            region: {
                type: 'object',
                properties: {
                    x: { type: 'integer' }, y: { type: 'integer' },
                    width: { type: 'integer' }, height: { type: 'integer' },
                },
                description: 'Optional crop to narrow the search area.',
            },
            dryRun: { type: 'boolean' },
            confirmCloudVisionCapture: {
                type: 'boolean',
                description: 'Explicitly grant cloud vision consent for this and future visual lookups.',
            },
        },
        required: ['description'],
    },
    async run(args, ctx) {
        if (!args.description) throw new Error('description is required');
        if (!permissions.hasCloudVisionConsent()) {
            if (!args.confirmCloudVisionCapture) {
                throw new Error(
                    'Cloud vision consent required before screenshots can be sent to the multimodal model. ' +
                    'Set confirmCloudVisionCapture=true once to grant.'
                );
            }
            permissions.grantCloudVisionConsent();
            events.publish('permissions.changed', { changedKeys: ['cloudVision.granted'], source: 'find_and_click_visual' });
        }

        // 1) Capture
        const cap = await screen._captureBuffer({
            x: args.region?.x, y: args.region?.y,
            width: args.region?.width, height: args.region?.height,
        });

        // 2) Ask vision model for coords
        let coords = null;
        try {
            const { createLlmProvider } = require('./llm-provider');
            const llm = createLlmProvider();
            // Reuse the token loading pattern from agent-loop
            const path = require('path'); const fs = require('fs'); const os = require('os');
            const cfgPath = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources', 'settings.json');
            if (fs.existsSync(cfgPath)) {
                const s = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
                if (s.githubToken) llm.setToken(s.githubToken);
            }
            const prompt = [
                `Find this UI element in the screenshot: "${args.description}".`,
                'Reply with ONLY a JSON object: {"x": <pixel>, "y": <pixel>, "confidence": 0-1, "note": "<short>"}',
                'Coordinates are in screen pixels measured from the top-left of the captured image.',
                'If you cannot find the element, return {"x":-1,"y":-1,"confidence":0,"note":"not found"}.',
            ].join('\n');
            const result = await llm.chatWithImage({
                prompt,
                imageBase64: cap.base64 || cap.buffer.toString('base64'),
                mimeType: 'image/png',
                modelId: 'openai/gpt-4o-mini',
                temperature: 0,
                maxLength: 200,
            });
            const m = (result.text || '').match(/\{[\s\S]*?\}/);
            if (m) coords = JSON.parse(m[0]);
        } catch (e) {
            return { ok: false, error: `vision lookup failed: ${e.message}` };
        }
        if (!coords || coords.x < 0 || coords.y < 0) {
            return { ok: false, error: 'element not located visually', coords };
        }

        // 3) Translate region-local → screen-absolute
        const absX = (args.region?.x || 0) + coords.x;
        const absY = (args.region?.y || 0) + coords.y;

        if (args.dryRun) {
            return { ok: true, dryRun: true, coords: { x: absX, y: absY }, confidence: coords.confidence };
        }

        // 4) Synthetic click via PowerShell SendInput
        const ps = `
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class M {
                [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
                [DllImport("user32.dll", CharSet=CharSet.Auto, CallingConvention=CallingConvention.StdCall)]
                public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
            }
"@
            [M]::SetCursorPos(${absX}, ${absY})
            Start-Sleep -Milliseconds 80
            [M]::mouse_event(0x02, 0, 0, 0, 0)  # LEFTDOWN
            Start-Sleep -Milliseconds 40
            [M]::mouse_event(0x04, 0, 0, 0, 0)  # LEFTUP
            "{\`"clickedAt\`":[${absX},${absY}]}"
        `;
        const out = await runPs(ps);
        try { ctx?.addAction?.({ tool: 'find_and_click_visual', args, result: { coords: { x: absX, y: absY } } }); } catch {}
        return { ok: true, coords: { x: absX, y: absY }, confidence: coords.confidence, raw: out };
    },
};

function runPs(script) {
    return new Promise((resolve, reject) => {
        const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-']);
        let stdout = '', stderr = '';
        p.stdout.on('data', d => stdout += d);
        p.stderr.on('data', d => stderr += d);
        p.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
        p.stdin.end(script);
    });
}

module.exports = { findVisualTarget };
