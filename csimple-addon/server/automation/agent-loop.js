/**
 * Agent Loop — ReAct-style controller that pursues a user goal by repeatedly
 * asking the LLM what to do next and executing tool calls.
 *
 * Architecture:
 *   1. On start: GET /workspace/goals/next (highest-priority active goal)
 *   2. Build a system prompt:
 *        - Goal title + success criteria + constraints
 *        - Available tools (registry.toolSchemasForLlm())
 *        - Recent action log tail (so the LLM doesn't repeat itself)
 *        - The full workspaceContext (CORE/USER/MEMORY/goals/recent actions)
 *   3. Loop step:
 *        a) Ask LLM with tools=available, messages=[system, ...recent]
 *        b) For each tool_call: registry.executeTool(name, args, ctx)
 *           - record the result in a `tool` message for the next turn
 *        c) If LLM returned a final text reply with no tool calls → consider
 *           the step "talked", check if it asked to stop
 *        d) After every step, append a one-line summary to action log
 *        e) Every REFLECT_EVERY steps, ask the LLM to write a `decision`
 *           item summarising what worked/didn't → long-term memory.
 *   4. Exit conditions:
 *        - goal_update set status to done/failed/blocked
 *        - max steps reached
 *        - LLM returns a text reply containing the sentinel "<<GOAL_DONE>>"
 *        - stop() called externally
 *        - kill switch activated
 *
 * The loop uses the addon's existing GitHubModelsService for LLM calls
 * (injected via opts.llmClient OR pulled from server/github-models-service).
 */

const path = require('path');

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_MODEL_ID = 'openai/gpt-4o-mini';
const REFLECT_EVERY = 5;
const STEP_DELAY_MS = 400;

function nowIso() { return new Date().toISOString(); }

function buildSystemPrompt({ goal, workspaceContext, toolNames }) {
    return [
        'You are an autonomous Windows automation agent running inside the user\'s PC via the CSimple addon.',
        'You are pursuing a specific GOAL on behalf of the user. Take small, deliberate steps.',
        '',
        '== GOAL ==',
        `Title: ${goal.name}`,
        goal.successCriteria ? `Success criteria: ${goal.successCriteria}` : '',
        goal.constraints ? `Constraints: ${goal.constraints}` : '',
        '',
        'Goal details:',
        (goal.content || '(no further detail)').trim(),
        '',
        '== RULES ==',
        '1. Prefer the safest tool that gets the job done. Use uia_* over screen_capture+click when possible.',
        '2. Use shell_run for read-only inspection freely; destructive shell commands will be refused.',
        '3. After each meaningful step, briefly say what you observed and what you\'ll try next.',
        '4. If you are stuck or need a human decision, call goal_ask_user — do NOT keep retrying blindly.',
        '5. When the success criteria are satisfied, call goal_update with status="done" AND respond with the sentinel "<<GOAL_DONE>>" on its own line. The loop will stop.',
        '6. When you have done enough that the user should review, you may also stop with "<<GOAL_DONE>>".',
        '7. Never call tools that you don\'t need. Avoid spamming screen_capture; capture only when vision is required.',
        '',
        '== AVAILABLE TOOLS ==',
        toolNames.join(', '),
        '',
        '== USER WORKSPACE CONTEXT ==',
        (workspaceContext || '(no workspace context loaded)').trim(),
    ].filter(Boolean).join('\n');
}

function reflectionPrompt(goal) {
    return [
        `Pause and reflect on progress toward goal "${goal.name}".`,
        'Write a SHORT (<= 6 lines) JSON object with fields:',
        '  { "title": "...", "progress": "what advanced", "blockers": "what didn\'t work", "next": "next focused step" }',
        'Reply with ONLY the JSON, no prose.',
    ].join('\n');
}

function createAgentLoop({ wsClient, registry, contextFactory, log = console.log, llmClient }) {
    let state = {
        running: false,
        currentGoal: null,
        step: 0,
        lastTick: null,
        startedAt: null,
        history: [],         // { role, content, tool_calls?, tool_call_id? }
        stopReason: null,
        modelId: DEFAULT_MODEL_ID,
        maxSteps: DEFAULT_MAX_STEPS,
        dryRun: false,
        abortController: null,
    };

    function _lazyLoadLlm() {
        if (llmClient) return llmClient;
        // Lazy require to avoid circular deps at server boot.
        try {
            const { GitHubModelsService } = require('../github-models-service');
            llmClient = new GitHubModelsService();
            // Token: pull from webapp settings (same pattern the chat endpoint uses).
            try {
                const fs = require('fs');
                const os = require('os');
                const cfgPath = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources', 'settings.json');
                if (fs.existsSync(cfgPath)) {
                    const s = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
                    if (s.githubToken) llmClient.setToken(s.githubToken);
                }
            } catch {}
            return llmClient;
        } catch (e) {
            throw new Error('No LLM client available: ' + e.message);
        }
    }

    async function _stepOnce(ctx) {
        state.step++;
        state.lastTick = nowIso();

        const llm = _lazyLoadLlm();
        const toolSchemas = registry.toolSchemasForLlm();
        const toolNames = toolSchemas.map(t => t.function.name);

        // Refresh workspace context every step (cheap; ensures memory edits land).
        let wsContextString = '';
        try {
            const ctxPreview = await wsClient.getContext({ message: state.currentGoal?.name });
            wsContextString = ctxPreview?.workspaceContext || '';
        } catch (e) {
            log('[agent] workspace context fetch failed:', e.message);
        }

        const systemPrompt = buildSystemPrompt({
            goal: state.currentGoal,
            workspaceContext: wsContextString,
            toolNames,
        });

        // Last user-ish message: a tick prompt that nudges the model to take the
        // next concrete action OR call goal_update to finalize.
        const userTick = state.step === 1
            ? 'Begin. What is your first action?'
            : 'Continue. Based on the recent action results, what is your next action? Use a tool, or finalize with goal_update + "<<GOAL_DONE>>".';

        const messages = [
            { role: 'user', content: userTick },
            ...state.history.slice(-12), // cap history to ~12 turns
        ];

        let result;
        try {
            result = await llm.chat({
                message: userTick,
                modelId: state.modelId,
                systemPrompt,
                temperature: 0.2,
                maxLength: 800,
                conversationHistory: state.history.slice(-12),
                tools: toolSchemas,
                tool_choice: 'auto',
            });
        } catch (e) {
            log('[agent] LLM error:', e.message);
            return { stop: false, reason: 'llm-error' };
        }

        const text = (result?.text || '').trim();
        const toolCalls = result?.toolCalls || [];

        // Echo assistant message into history.
        state.history.push({
            role: 'assistant',
            content: text || null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });

        // Execute tool calls
        for (const tc of toolCalls) {
            let argsObj = {};
            try { argsObj = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {}); }
            catch { argsObj = {}; }
            const out = await registry.executeTool(tc.function.name, argsObj, ctx);
            // Compact tool result for next turn — full result already in action log
            const summary = JSON.stringify({
                ok: out.ok,
                ...(out.ok ? { result: typeof out.result === 'string' ? out.result.slice(0, 800) : out.result } : { error: out.error }),
                mode: out.mode,
                durationMs: out.durationMs,
            }).slice(0, 1200);
            state.history.push({
                role: 'tool',
                tool_call_id: tc.id || `${tc.function.name}_${state.step}`,
                content: summary,
            });
            log(`[agent] step ${state.step} tool=${tc.function.name} ok=${out.ok}`);
        }

        // Stop sentinel
        if (text.includes('<<GOAL_DONE>>')) {
            return { stop: true, reason: 'goal-done-sentinel' };
        }

        // Reflection
        if (state.step % REFLECT_EVERY === 0) {
            try {
                const refl = await llm.chat({
                    message: reflectionPrompt(state.currentGoal),
                    modelId: state.modelId,
                    systemPrompt: 'You are reflecting on agent progress. Output ONLY the requested JSON.',
                    temperature: 0,
                    maxLength: 300,
                    conversationHistory: state.history.slice(-8),
                });
                const reflectionText = (refl?.text || '').trim();
                if (reflectionText) {
                    await wsClient.upsertGoal(
                        // Write reflection under decision/<goalslug>-<step>
                        // — actually, use kind=goal append for tighter loop;
                        // here we just append to the goal content
                        state.currentGoal.slug, {
                            name: state.currentGoal.name,
                            content: (state.currentGoal.content || '') + `\n\n[reflection ${nowIso()}] ${reflectionText}`,
                            status: state.currentGoal.status,
                        }
                    ).catch(err => log('[agent] reflection persist failed:', err.message));
                }
            } catch (e) {
                log('[agent] reflection failed:', e.message);
            }
        }

        return { stop: false };
    }

    async function _runLoop() {
        const ctx = contextFactory({ goalSlug: state.currentGoal.slug });

        while (state.running && state.step < state.maxSteps) {
            // Re-check goal status each step in case the user edited it.
            try {
                const fresh = await wsClient.getGoal(state.currentGoal.slug);
                if (!fresh || ['done', 'failed', 'paused', 'blocked'].includes(fresh.status)) {
                    state.stopReason = `goal status=${fresh?.status || 'missing'}`;
                    break;
                }
                state.currentGoal = fresh;
            } catch (e) {
                log('[agent] goal refresh failed:', e.message);
            }

            const r = await _stepOnce(ctx);
            if (r.stop) {
                state.stopReason = r.reason;
                break;
            }
            await new Promise(res => setTimeout(res, STEP_DELAY_MS));
        }

        if (state.step >= state.maxSteps && !state.stopReason) {
            state.stopReason = 'max-steps-reached';
        }
        state.running = false;
        log(`[agent] loop exited: ${state.stopReason} (steps=${state.step})`);
    }

    async function start(opts = {}) {
        if (state.running) return { running: true, reason: 'already running', currentGoal: state.currentGoal?.slug };
        // If no slug provided, fetch next.
        let goal = null;
        if (opts.goalSlug) {
            goal = await wsClient.getGoal(opts.goalSlug);
        } else {
            goal = await wsClient.getNextGoal();
        }
        if (!goal) return { running: false, reason: 'no-active-goal' };

        state = {
            running: true,
            currentGoal: goal,
            step: 0,
            lastTick: nowIso(),
            startedAt: nowIso(),
            history: [],
            stopReason: null,
            modelId: opts.modelId || DEFAULT_MODEL_ID,
            maxSteps: Math.min(100, Math.max(1, opts.maxSteps || DEFAULT_MAX_STEPS)),
            dryRun: !!opts.dryRun,
            abortController: null,
        };
        log(`[agent] start goal=${goal.slug} maxSteps=${state.maxSteps} dryRun=${state.dryRun}`);
        _runLoop().catch(e => log('[agent] loop crashed:', e.message));
        return { running: true, currentGoal: goal.slug, startedAt: state.startedAt };
    }

    function stop(reason = 'manual') {
        if (!state.running) return { running: false, reason: 'already stopped' };
        state.running = false;
        state.stopReason = reason;
        log(`[agent] stop requested: ${reason}`);
        return { running: false, reason };
    }

    function status() {
        return {
            running: state.running,
            currentGoal: state.currentGoal ? { slug: state.currentGoal.slug, name: state.currentGoal.name, status: state.currentGoal.status } : null,
            step: state.step,
            startedAt: state.startedAt,
            lastTick: state.lastTick,
            stopReason: state.stopReason,
            modelId: state.modelId,
            maxSteps: state.maxSteps,
            dryRun: state.dryRun,
        };
    }

    return { start, stop, status, get running() { return state.running; } };
}

module.exports = { createAgentLoop };
