const { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');
const { 
    initializeLLMClients, 
    checkApiUsage, 
    createCompletionWithKey,
    trackCompletion,
    PROVIDERS,
    MODEL_TIER_REQUIREMENTS,
} = require('../utils/llmProviders.js');
const { isProTier, isSimpleTier } = require('../constants/pricing.js');
const { getGoalsSummary, logAction } = require('./memoryService.js');
const { TOOL_SCHEMAS, executeTool } = require('./netTools.js');

// Constants for user context loading
const CSIMPLE_CREATED_AT = '2000-01-01T00:00:00.000Z';
const MAX_CONTEXT_BYTES = 16 * 1024;
const MAX_SINGLE_FILE = 32 * 1024;
const CTX_PRIORITY_PATTERNS = [/^user/i, /profile/i, /preference/i, /identity/i, /name/i];

/**
 * Load user's CSimple context (memory, personality, behavior) directly from DynamoDB.
 * This is the same logic as the /csimple/context endpoint but called internally.
 */
async function loadUserContextFromDB(dynamodb, userId, behaviorFile = 'default.txt') {
    const TABLE_NAME = 'Simple';

    // ── Load memory files ──
    const memPrefix = `csimple_memory_${userId}_`;
    const { Items: memItems } = await dynamodb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(id, :prefix)',
        ExpressionAttributeValues: { ':prefix': memPrefix },
    }));

    let memoryContext = '';
    if (memItems && memItems.length > 0) {
        const fileInfos = memItems.map(item => ({
            name: item.id.replace(memPrefix, ''),
            content: (item.text || '').trim(),
            size: Buffer.byteLength(item.text || '', 'utf-8'),
        }));
        fileInfos.sort((a, b) => {
            const aPri = CTX_PRIORITY_PATTERNS.some(p => p.test(a.name)) ? 0 : 1;
            const bPri = CTX_PRIORITY_PATTERNS.some(p => p.test(b.name)) ? 0 : 1;
            if (aPri !== bPri) return aPri - bPri;
            return a.size - b.size;
        });

        const memories = [];
        let totalSize = 0;
        for (const info of fileInfos) {
            if (info.size > MAX_SINGLE_FILE || !info.content) continue;
            if (totalSize + info.size > MAX_CONTEXT_BYTES) {
                memories.push('[Memory truncated — more files not loaded due to size limit]');
                break;
            }
            const displayName = info.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
            memories.push(`## ${displayName}\n${info.content}`);
            totalSize += info.size;
        }
        if (memories.length > 0) {
            memoryContext = '\n\n--- MEMORY (persistent knowledge) ---\n' + memories.join('\n\n') + '\n--- END MEMORY ---\n';
        }
    }

    // ── Load personality files ──
    const persPrefix = `csimple_personality_${userId}_`;
    const { Items: persItems } = await dynamodb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(id, :prefix)',
        ExpressionAttributeValues: { ':prefix': persPrefix },
    }));

    let personalityContext = '';
    if (persItems && persItems.length > 0) {
        const sections = persItems.map(item => (item.text || '').trim()).filter(Boolean);
        if (sections.length > 0) {
            personalityContext = '\n\n---\n' + sections.join('\n\n---\n') + '\n\n---\n';
        }
    }

    // ── Load behavior file ──
    let behaviorContext = '';
    if (behaviorFile) {
        try {
            const bhvId = `csimple_behavior_${userId}_${behaviorFile}`;
            const { Item } = await dynamodb.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { id: bhvId, createdAt: CSIMPLE_CREATED_AT },
            }));
            if (Item?.text) {
                behaviorContext = '\n\n--- BEHAVIOR INSTRUCTIONS ---\n' + Item.text.trim() + '\n--- END BEHAVIOR ---\n';
            }
        } catch { /* behavior not found — ok */ }
    }

    return {
        memoryContext,
        personalityContext,
        behaviorContext,
        hasMemory: memoryContext.length > 0,
        hasPersonality: personalityContext.length > 0,
        hasBehavior: behaviorContext.length > 0,
    };
}

/**
 * Parse compression request data
 * @param {Object} req - Express request object
 * @returns {Object} Parsed data
 */
function parseCompressionRequest(req) {
    const parsedJSON = JSON.parse(req.body.data);
    console.log('Request body:', parsedJSON);

    const updateId = req.body.updateId;
    console.log('Update ID:', updateId);

    const itemID = parsedJSON._id;
    const contextInput = parsedJSON.text;
    console.log('Context input:', contextInput);

    // Get LLM provider and model from request (GitHub Models only)
    const provider = req.body.provider || 'github';
    if (provider !== 'github') {
        const error = new Error(`Provider "${provider}" is not supported. Only GitHub Models is available.`);
        error.statusCode = 400;
        throw error;
    }
    const model = req.body.model || 'gpt-4o-mini';
    
    console.log(`Using ${provider} with model ${model}`);

    if (typeof contextInput !== 'string') {
        const error = new Error('Data input invalid');
        error.statusCode = 400;
        throw error;
    }

    const netIndex = contextInput.indexOf('Net:');
    const userInput = netIndex >= 0 ? contextInput.substring(netIndex + 4) : contextInput;

    console.log('User input:', userInput);

    return { updateId, itemID, contextInput, provider, model, userInput };
}

/**
 * Build the base system prompt parts used by both callLLMApi and streamCompressionRequest.
 */
function buildSystemPromptParts(goalsSummary) {
    const parts = [
        'You are a helpful AI assistant on sthopwood.com\'s /net chat.',
        'You have access to tools that let you take real actions — save goals, notes, log actions, submit support tickets, search the web, do math, and more.',
        'Use tools when the user\'s intent clearly calls for an action (e.g. "remember this", "I want to achieve X", "submit a bug report", "what time is it", "calculate 15% of 200").',
        'For normal conversation, questions, or requests for information, just reply in text.',
        'Be concise and helpful. When you use a tool, also include a brief conversational response explaining what you did.',
        'Each message in the conversation is prefixed with a timestamp in brackets like [1/15/2025, 2:30:00 PM]. Use these timestamps for temporal context — you can reference when things were said, how much time has passed, and be aware of the current date and time.',
        'When the user asks you to write, create, or generate content (code, scripts, emails, documents, etc.), present the content directly in your response using proper formatting (e.g. code blocks for code). If the content might be useful to save, briefly mention they can copy it or ask you to save it as a note.',
        'AUTO-MEMORY: You can save important facts about the user (name, preferences, important dates, context) by including a [MEMORY_SAVE:filename] block in your response. Format:\n[MEMORY_SAVE:user_profile.md]\n- Name: John\n- Preference: dark mode\n[/MEMORY_SAVE]\nUse this when the user shares personal info, asks you to remember something, or reveals preferences. Keep memory files small and focused. Do NOT announce the memory save to the user — just do it silently alongside your normal response.',
    ];

    if (goalsSummary) {
        parts.push(`\nThe following is context about the user's goals and priorities — use this to personalize your responses when relevant:\n\n${goalsSummary}`);
    }

    return parts;
}

/**
 * Inject membership tier context into the system prompt so the AI is aware of
 * the user's plan, remaining credits, and available features.
 */
function injectMembershipContext(systemParts, user) {
    const text = user?.text || '';
    const rankMatch = text.match(/\|Rank:(\w+)/);
    const rank = rankMatch ? rankMatch[1] : 'Free';

    const creditsMatch = text.match(/\|Credits:([^|]*)/);
    let creditInfo = '';
    if (creditsMatch) {
        try {
            const credits = JSON.parse(creditsMatch[1]);
            const spent = credits.totalSpent || 0;
            const limit = credits.customLimit || credits.monthlyLimit || 0;
            creditInfo = ` Credits used: $${spent.toFixed(2)}${limit ? ` of $${limit.toFixed(2)} limit` : ''}.`;
        } catch {}
    }

    const tierFeatures = {
        Free: 'Free tier (50 cmds/day, 100MB storage, basic models).',
        Pro: 'Pro tier ($12/mo — 500 cmds/day, 5GB storage, all standard models, email support).',
        Simple: 'Simple tier ($39/mo — 5000 cmds/day, 50GB storage, all models including premium, priority support).',
    };

    const tierDesc = tierFeatures[rank] || tierFeatures.Free;
    systemParts.push(`\nUSER MEMBERSHIP: ${tierDesc}${creditInfo} When the user asks about their plan, credits, or features, answer accurately based on this information. If they ask about upgrading, direct them to /pay.`);
}

/**
 * Auto-summarize conversation history when it exceeds a threshold.
 * Keeps the first message (for context) and last N messages, replacing
 * the middle with a summary message.
 */
function compressConversationHistory(messages, maxMessages = 30) {
    // Only compress if significantly over limit (user + assistant pairs)
    if (messages.length <= maxMessages) return messages;

    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    // Keep first 2 exchanges + last (maxMessages - 4) messages
    const keepStart = 4;
    const keepEnd = maxMessages - keepStart - 1; // -1 for summary msg
    const toSummarize = nonSystem.slice(keepStart, -keepEnd);

    if (toSummarize.length < 4) return messages; // Not worth summarizing

    // Build a condensed summary of the middle messages
    const summaryLines = toSummarize.map(m => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const text = (m.content || '').substring(0, 150);
        return `${role}: ${text}${m.content?.length > 150 ? '...' : ''}`;
    });

    const summaryMsg = {
        role: 'system',
        content: `[CONVERSATION SUMMARY — ${toSummarize.length} messages condensed]\n${summaryLines.join('\n')}\n[END SUMMARY — recent messages follow]`,
    };

    return [
        ...systemMsgs,
        ...nonSystem.slice(0, keepStart),
        summaryMsg,
        ...nonSystem.slice(-keepEnd),
    ];
}

/**
 * Estimate the cost of an LLM call based on token counts.
 */
function estimateCost(provider, model, promptTokens, completionTokens) {
    const { API_COSTS } = require('../utils/apiUsageTracker');
    const providerCosts = API_COSTS[provider];
    if (!providerCosts) return null;
    const modelCost = providerCosts[model] || providerCosts.default;
    if (!modelCost) return null;
    const cost = (promptTokens * modelCost.input) + (completionTokens * modelCost.output);
    return Math.round(cost * 1000000) / 1000000; // 6 decimal places
}

/**
 * Generate a smart conversation title from the first exchange.
 */
async function generateConversationTitle(message, response, githubToken) {
    try {
        await initializeLLMClients();
        const titleMessages = [
            { role: 'system', content: 'Generate a concise 3-6 word title for this conversation. Return ONLY the title text, no quotes or punctuation.' },
            { role: 'user', content: `User said: "${message.substring(0, 200)}"\nAssistant replied about: "${response.substring(0, 200)}"` },
        ];
        const titleResp = await createCompletionWithKey('github', 'gpt-4.1-nano', titleMessages, { maxTokens: 20, temperature: 0.5 }, githubToken);
        const title = titleResp?.choices?.[0]?.message?.content?.trim();
        return title && title.length > 0 && title.length < 60 ? title : null;
    } catch {
        return null;
    }
}

/**
 * Check if user's membership tier allows the requested model.
 * Throws 403 if the model requires a higher tier.
 */
function validateModelTierAccess(user, model) {
    const requiredTier = MODEL_TIER_REQUIREMENTS[model];
    if (!requiredTier || requiredTier === 'free') return; // No restriction

    const text = user?.text || '';
    const rankMatch = text.match(/\|Rank:(\w+)/);
    const rank = rankMatch ? rankMatch[1] : 'Free';

    if (requiredTier === 'pro' && !isProTier(rank) && !isSimpleTier(rank)) {
        const error = new Error(`Model "${model}" requires a Pro or Simple membership. Upgrade at /pay to access this model.`);
        error.statusCode = 403;
        throw error;
    }
    if (requiredTier === 'simple' && !isSimpleTier(rank)) {
        const error = new Error(`Model "${model}" requires a Simple membership. Upgrade at /pay to access this model.`);
        error.statusCode = 403;
        throw error;
    }
}

/**
 * Check if user can make API call
 * @param {string} userId - User ID
 * @param {string} provider - LLM provider
 * @param {string} model - Model name
 * @param {string} userInput - User input
 * @returns {Object} Usage check result
 */
async function validateApiUsage(userId, provider, model, userInput) {
    console.log('🔍 Starting API validation check...');
    const startValidation = Date.now();
    
    const usageCheck = await checkApiUsage(userId, provider, model, userInput);

    console.log(`✅ API validation completed in ${Date.now() - startValidation}ms`);

    if (!usageCheck.canMake) {
        console.log(`${provider.toUpperCase()} API call blocked:`, usageCheck.reason);
        const error = new Error('API usage limit reached');
        error.statusCode = 402;
        error.details = {
            error: 'API usage limit reached',
            reason: usageCheck.reason,
            currentUsage: usageCheck.currentUsage,
            limit: usageCheck.limit,
            requiresUpgrade: true,
            provider: provider,
            model: model
        };
        throw error;
    }

    return usageCheck;
}

/**
 * Fetch a user's GitHub PAT from their CSimple settings in DynamoDB.
 * Returns null if not found.
 */
async function getUserGithubToken(dynamodb, userId) {
    try {
        const { Item } = await dynamodb.send(new GetCommand({
            TableName: 'Simple',
            Key: { id: `csimple_settings_${userId}`, createdAt: '2000-01-01T00:00:00.000Z' }
        }));
        if (!Item?.text) return null;
        const settings = JSON.parse(Item.text);
        return settings.githubToken || null;
    } catch (e) {
        console.error('[llmService] Failed to fetch user github token:', e);
        return null;
    }
}

/**
 * Call LLM API with tool-use support.
 * The LLM decides whether to reply in text, call tools, or both.
 * Handles the tool-call loop: LLM → tool calls → feed results back → final text.
 *
 * @param {string} provider - LLM provider
 * @param {string} model - Model name
 * @param {string} userInput - User input
 * @param {string|null} githubToken - Per-user GitHub PAT (only for provider='github')
 * @param {string|null} goalsSummary - User's goals context
 * @param {object|null} toolContext - { userId, userEmail, userName } for tool execution
 * @param {object|null} userContext - { memoryContext, personalityContext, behaviorContext } from DB
 * @returns {Object} LLM response (final, after any tool calls are resolved)
 */
async function callLLMApi(provider, model, userInput, githubToken = null, goalsSummary = null, toolContext = null, userContext = null, maxTokensOverride = null, user = null) {
    await initializeLLMClients();
    
    console.log(`🤖 Starting ${provider.toUpperCase()} API call...`);
    const startLLM = Date.now();

    // Build messages array — if userInput is a Net: chat payload, extract conversation history
    let messages;
    try {
        const parsed = JSON.parse(userInput);
        if (parsed.message && Array.isArray(parsed.conversationHistory)) {
            // Reconstruct proper multi-turn conversation
            messages = [
                ...parsed.conversationHistory.map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: parsed.message }
            ];
        } else {
            messages = [{ role: 'user', content: userInput }];
        }
    } catch {
        messages = [{ role: 'user', content: userInput }];
    }

    // Auto-compress long conversation history
    messages = compressConversationHistory(messages);

    // System prompt with tool awareness
    const systemParts = buildSystemPromptParts(goalsSummary);

    // Inject membership tier awareness
    if (user) injectMembershipContext(systemParts, user);


    // Inject user context from cloud DB (memory, personality, behavior)
    if (userContext) {
        if (userContext.personalityContext) {
            systemParts.push(userContext.personalityContext);
        }
        if (userContext.memoryContext) {
            systemParts.push(userContext.memoryContext);
        }
        if (userContext.behaviorContext) {
            systemParts.push(userContext.behaviorContext);
        }
    }

    messages.unshift({
        role: 'system',
        content: systemParts.join(' ')
    });
    
    if (!githubToken) {
        const error = new Error('GitHub token not configured. Add your GitHub PAT in CSimple → Settings → Advanced → GitHub Personal Access Token.');
        error.statusCode = 401;
        throw error;
    }

    // Determine if we should send tools (only for Net: chat, not plain compression)
    const useTools = toolContext !== null;
    const llmOptions = { maxTokens: maxTokensOverride || 1000, temperature: 0.7 };
    if (useTools) {
        llmOptions.tools = TOOL_SCHEMAS;
        llmOptions.tool_choice = 'auto';
    }

    // Initial LLM call
    let response = await createCompletionWithKey('github', model, messages, llmOptions, githubToken);
    
    // ─── Tool-call loop (max 3 rounds to prevent runaway) ────────────────
    const MAX_TOOL_ROUNDS = 3;
    let round = 0;
    const toolResults = []; // Track executed tools for logging

    while (useTools && round < MAX_TOOL_ROUNDS) {
        const choice = response?.choices?.[0];
        if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
            break; // No tool calls — LLM is done
        }

        round++;
        console.log(`🔧 Tool call round ${round}: ${choice.message.tool_calls.length} tool(s) requested`);

        // Add the assistant's tool-call message to conversation
        messages.push(choice.message);

        // Execute each tool call and collect results
        for (const toolCall of choice.message.tool_calls) {
            const fnName = toolCall.function.name;
            let fnArgs;
            try {
                fnArgs = JSON.parse(toolCall.function.arguments);
            } catch {
                fnArgs = {};
            }

            console.log(`🔧 Executing tool: ${fnName}`, JSON.stringify(fnArgs));
            const result = await executeTool(fnName, fnArgs, toolContext);
            console.log(`🔧 Tool result: ${result.substring(0, 200)}`);

            toolResults.push({ tool: fnName, args: fnArgs, result });

            // Add tool result to conversation for the LLM to incorporate
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result,
            });
        }

        // Call LLM again with tool results so it can produce a final response
        response = await createCompletionWithKey('github', model, messages, llmOptions, githubToken);
    }

    console.log(`🤖 ${provider.toUpperCase()} API call completed in ${Date.now() - startLLM}ms (${round} tool round(s))`);
    console.log('LLM response:', JSON.stringify(response));
    
    // Attach tool execution metadata to the response for the frontend
    if (toolResults.length > 0) {
        response._toolsExecuted = toolResults.map(t => ({
            tool: t.tool,
            args: t.args,
            success: !t.result.startsWith('Error'),
        }));
    }

    return response;
}

/**
 * Track API usage after successful call
 * @param {string} userId - User ID
 * @param {string} provider - LLM provider
 * @param {string} model - Model name
 * @param {Object} response - LLM response
 * @param {string} userInput - User input
 */
async function trackApiUsageAfterCall(userId, provider, model, response, userInput) {
    console.log('📊 Starting usage tracking...');
    const startTracking = Date.now();
    
    const usageResult = await trackCompletion(userId, provider, model, response, userInput);

    console.log(`📊 Usage tracking completed in ${Date.now() - startTracking}ms`);

    if (!usageResult.success) {
        console.log('Usage tracking failed:', usageResult.error);
        // Continue anyway - don't fail the request for usage tracking issues
    }
}

/**
 * Save compressed data to DynamoDB
 * @param {Object} dynamodb - DynamoDB client
 * @param {string} userId - User ID
 * @param {string} userInput - User input
 * @param {string} compressedData - Compressed data
 * @param {string} updateId - Optional update ID for existing chat
 * @returns {Object} Result object with status and data
 */
async function saveCompressedData(dynamodb, userId, userInput, compressedData, updateId = null) {
    console.log('💾 Starting data saving...');
    const startSaving = Date.now();
    
    const newData = `Creator:${userId}|Net:${userInput}\n${compressedData}`;
    console.log('Saving data with format:', newData.substring(0, 100) + '...');

    if (updateId) {
        // Update existing item in DynamoDB
        console.log('Updating existing chat with ID:', updateId);
        const updateParams = {
            TableName: 'Simple',
            Key: { id: updateId },
            UpdateExpression: 'SET #text = :text, updatedAt = :updatedAt',
            ExpressionAttributeNames: { '#text': 'text' },
            ExpressionAttributeValues: {
                ':text': newData,
                ':updatedAt': new Date().toISOString()
            },
            ReturnValues: 'UPDATED_NEW'
        };

        try {
            const result = await dynamodb.send(new UpdateCommand(updateParams));
            console.log(`💾 Data saving completed in ${Date.now() - startSaving}ms`);
            console.log('Successfully updated existing chat');
            return { status: 200, data: { data: [compressedData] } };
        } catch (dbError) {
            console.error('Error updating DynamoDB:', dbError);
            const error = new Error('Failed to update data');
            error.statusCode = 500;
            throw error;
        }
    } else {
        // Create new item in DynamoDB
        console.log('Creating new chat entry');
        const newItemParams = {
            TableName: 'Simple',
            Item: {
                id: crypto.randomBytes(16).toString("hex"),
                text: newData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        };

        try {
            await dynamodb.send(new PutCommand(newItemParams));
            console.log(`💾 Data saving completed in ${Date.now() - startSaving}ms`);
            console.log('Successfully created new chat');
            return { status: 201, data: { data: [compressedData] } };
        } catch (dbError) {
            console.error('Error saving to DynamoDB:', dbError);
            const error = new Error('Failed to save data');
            error.statusCode = 500;
            throw error;
        }
    }
}

/**
 * Parse and save [MEMORY_SAVE:filename] blocks from LLM responses to cloud DB.
 * Mirrors the addon's processMemorySaves() but writes to DynamoDB instead of local files.
 * Returns cleaned content (blocks stripped) and list of saved memories.
 */
async function processCloudMemorySaves(dynamodb, userId, responseText) {
    if (!responseText) return { cleanedContent: responseText, savedMemories: [] };

    const MEMORY_SAVE_REGEX = /\[MEMORY_SAVE:([^\]]+)\]\s*\n([\s\S]*?)\[\/MEMORY_SAVE\]/g;
    const savedMemories = [];
    let match;

    while ((match = MEMORY_SAVE_REGEX.exec(responseText)) !== null) {
        const rawFilename = match[1].trim();
        const content = match[2].trim();

        // Validate filename (alphanumeric, dots, hyphens, underscores, spaces, parens)
        if (!/^[a-zA-Z0-9_\-. ()]{1,100}$/.test(rawFilename)) {
            console.log(`[CloudMemory] Rejected invalid filename: "${rawFilename}"`);
            continue;
        }

        // Validate content size (max 32KB)
        if (Buffer.byteLength(content, 'utf-8') > 32 * 1024) {
            console.log(`[CloudMemory] Content too large for "${rawFilename}"`);
            continue;
        }

        try {
            const itemId = `csimple_memory_${userId}_${rawFilename}`;
            const now = new Date().toISOString();

            // Check if exists for logging
            let isUpdate = false;
            try {
                const { Item } = await dynamodb.send(new GetCommand({
                    TableName: 'Simple',
                    Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
                }));
                isUpdate = !!Item;
            } catch { /* ok */ }

            await dynamodb.send(new PutCommand({
                TableName: 'Simple',
                Item: {
                    id: itemId,
                    text: content,
                    createdAt: CSIMPLE_CREATED_AT,
                    updatedAt: now,
                },
            }));

            savedMemories.push({ filename: rawFilename, action: isUpdate ? 'updated' : 'created' });
            console.log(`[CloudMemory] ${isUpdate ? 'Updated' : 'Created'} memory: ${rawFilename}`);
        } catch (err) {
            console.error(`[CloudMemory] Failed to save "${rawFilename}":`, err.message);
        }
    }

    // Strip memory save blocks from visible response
    const cleanedContent = responseText.replace(MEMORY_SAVE_REGEX, '').trim();

    if (savedMemories.length > 0) {
        console.log(`[CloudMemory] Processed ${savedMemories.length} memory save(s) for user ${userId}`);
    }

    return { cleanedContent, savedMemories };
}

/**
 * Process compression request - orchestrates the entire compression flow
 * @param {Object} req - Express request object
 * @param {Object} dynamodb - DynamoDB client
 * @returns {Object} Result with status and data
 */
async function processCompressionRequest(req, dynamodb) {
    const startValidation = Date.now();
    
    // Parse request
    const { updateId, userInput, provider, model } = parseCompressionRequest(req);
    
    // Check tier access for the requested model
    validateModelTierAccess(req.user, model);
    
    // Validate API usage
    await validateApiUsage(req.user.id, provider, model, userInput);
    
    // For GitHub provider, look up the user's GitHub PAT from their CSimple settings
    let githubToken = null;
    if (provider === 'github') {
        githubToken = await getUserGithubToken(dynamodb, req.user.id);
        if (!githubToken) {
            const error = new Error('GitHub token not configured. Add your GitHub PAT in CSimple → Settings → Advanced.');
            error.statusCode = 401;
            throw error;
        }
        console.log('[llmService] Using user\'s GitHub token for GitHub Models API');
    }
    
    // Fetch user's active goals to inject as context
    let goalsSummary = null;
    try {
        goalsSummary = await getGoalsSummary(req.user.id);
        if (goalsSummary) console.log('[llmService] Injecting goals context for user');
    } catch (err) {
        console.warn('[llmService] Failed to fetch goals summary:', err.message);
    }
    
    // Build tool context for Net: chat messages (enables function calling)
    // Only Net: chat gets tools — other compression requests remain plain text
    let toolContext = null;
    let behaviorFile = 'default.txt';
    try {
        const parsed = JSON.parse(userInput);
        if (parsed.message && Array.isArray(parsed.conversationHistory)) {
            toolContext = {
                userId: req.user.id,
                userEmail: req.user.email || null,
                userName: req.user.nickname || req.user.name || null,
            };
            behaviorFile = parsed.behaviorFile || 'default.txt';
            console.log('[llmService] Net: chat detected — enabling tool-use');
        }
    } catch {
        // Not a Net: chat payload — no tools
    }

    // Load user context (memory, personality, behavior) from cloud DB
    let userContext = null;
    try {
        userContext = await loadUserContextFromDB(dynamodb, req.user.id, behaviorFile);
        if (userContext) {
            const parts = [
                userContext.hasMemory ? 'memory' : null,
                userContext.hasPersonality ? 'personality' : null,
                userContext.hasBehavior ? 'behavior' : null,
            ].filter(Boolean);
            if (parts.length > 0) {
                console.log(`[llmService] Injecting user context: ${parts.join(', ')}`);
            }
        }
    } catch (err) {
        console.warn('[llmService] Failed to load user context:', err.message);
    }

    // Call LLM API (with tools if Net: chat)
    const maxTokens = getMaxTokensForRequest(req.user, model);
    const response = await callLLMApi(provider, model, userInput, githubToken, goalsSummary, toolContext, userContext, maxTokens, req.user);
    
    // Track API usage
    await trackApiUsageAfterCall(req.user.id, provider, model, response, userInput);
    
    // Check if response has content
    const content = response?.choices?.[0]?.message?.content;
    if (content && content.length > 0) {
        // Process any [MEMORY_SAVE:filename] blocks in the LLM response
        const { cleanedContent, savedMemories } = await processCloudMemorySaves(dynamodb, req.user.id, content);

        const compressedData = cleanedContent;
        
        // Save to DynamoDB
        const result = await saveCompressedData(dynamodb, req.user.id, userInput, compressedData, updateId);
        
        // Attach memory save info to result for frontend awareness
        if (savedMemories.length > 0) {
            result.memorySaves = savedMemories;
        }
        
        // Auto-log the action (fire-and-forget — don't block the response)
        try {
            // Extract the plain user message for the action log
            let actionSummary;
            try {
                const parsed = JSON.parse(userInput);
                actionSummary = parsed.message || userInput;
            } catch { actionSummary = userInput; }
            if (actionSummary.length > 120) actionSummary = actionSummary.substring(0, 117) + '...';
            logAction(req.user.id, `Chat: ${actionSummary}`, 'net').catch(() => {});
        } catch {}
        
        console.log(`💾 Total operation completed in ${Date.now() - startValidation}ms`);
        return result;
    } else {
        console.log(`💾 Total operation completed in ${Date.now() - startValidation}ms`);
        const error = new Error('No response content returned from GitHub Models API.');
        error.statusCode = 500;
        throw error;
    }
}

/**
 * Stream a compression request via SSE.
 * Sends token-by-token chunks as `data:` events.
 * Final event is `data: [DONE]`.
 */
async function streamCompressionRequest(req, res, dynamodb) {
    const startValidation = Date.now();

    // Parse request
    const { updateId, userInput, provider, model } = parseCompressionRequest(req);

    // Check tier access for the requested model
    validateModelTierAccess(req.user, model);

    // Validate API usage
    await validateApiUsage(req.user.id, provider, model, userInput);

    // Get GitHub PAT
    let githubToken = null;
    if (provider === 'github') {
        githubToken = await getUserGithubToken(dynamodb, req.user.id);
        if (!githubToken) {
            const error = new Error('GitHub token not configured. Add your GitHub PAT in CSimple → Settings → Advanced.');
            error.statusCode = 401;
            throw error;
        }
    }

    // Fetch goals context
    let goalsSummary = null;
    try {
        goalsSummary = await getGoalsSummary(req.user.id);
    } catch {}

    // Build tool context for Net: chat messages
    let toolContext = null;
    let behaviorFile = 'default.txt';
    try {
        const parsed = JSON.parse(userInput);
        if (parsed.message && Array.isArray(parsed.conversationHistory)) {
            toolContext = {
                userId: req.user.id,
                userEmail: req.user.email || null,
                userName: req.user.nickname || req.user.name || null,
            };
            behaviorFile = parsed.behaviorFile || 'default.txt';
        }
    } catch {}

    // Load user context
    let userContext = null;
    try {
        userContext = await loadUserContextFromDB(dynamodb, req.user.id, behaviorFile);
    } catch {}

    // ── Build messages (same logic as callLLMApi) ─────────────────────────
    await initializeLLMClients();

    let messages;
    try {
        const parsed = JSON.parse(userInput);
        if (parsed.message && Array.isArray(parsed.conversationHistory)) {
            messages = [
                ...parsed.conversationHistory.map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: parsed.message }
            ];
        } else {
            messages = [{ role: 'user', content: userInput }];
        }
    } catch {
        messages = [{ role: 'user', content: userInput }];
    }

    // Auto-compress long conversation history
    messages = compressConversationHistory(messages);

    // Build system prompt
    const systemParts = buildSystemPromptParts(goalsSummary);
    injectMembershipContext(systemParts, req.user);
    if (userContext) {
        if (userContext.personalityContext) systemParts.push(userContext.personalityContext);
        if (userContext.memoryContext) systemParts.push(userContext.memoryContext);
        if (userContext.behaviorContext) systemParts.push(userContext.behaviorContext);
    }
    messages.unshift({ role: 'system', content: systemParts.join(' ') });

    if (!githubToken) {
        const error = new Error('GitHub token not configured.');
        error.statusCode = 401;
        throw error;
    }

    const useTools = toolContext !== null;

    // Determine max tokens based on tier + model
    const maxTokens = getMaxTokensForRequest(req.user, model);

    const llmOptions = { maxTokens, temperature: 0.7 };
    if (useTools) {
        llmOptions.tools = TOOL_SCHEMAS;
        llmOptions.tool_choice = 'auto';
    }

    // ── Tool-call phase (non-streamed, same as before) ─────────────────────
    // We must resolve tools before streaming the final answer
    const MAX_TOOL_ROUNDS = 3;
    let round = 0;
    const toolResults = [];
    let needsStreaming = true;

    if (useTools) {
        // Do an initial non-streaming call to check for tool calls
        const initResponse = await createCompletionWithKey('github', model, messages, llmOptions, githubToken);
        let choice = initResponse?.choices?.[0];

        while (choice?.message?.tool_calls && choice.message.tool_calls.length > 0 && round < MAX_TOOL_ROUNDS) {
            round++;
            messages.push(choice.message);

            for (const toolCall of choice.message.tool_calls) {
                const fnName = toolCall.function.name;
                let fnArgs;
                try { fnArgs = JSON.parse(toolCall.function.arguments); } catch { fnArgs = {}; }
                const result = await executeTool(fnName, fnArgs, toolContext);
                toolResults.push({ tool: fnName, args: fnArgs, result });
                messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
            }

            // Check if the follow-up also has tool calls
            const followUp = await createCompletionWithKey('github', model, messages, llmOptions, githubToken);
            choice = followUp?.choices?.[0];

            // If no more tools, we'll stream the final response from scratch
            if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
                // The follow-up already has the final text — send it non-streamed
                const content = choice?.message?.content || '';
                const { cleanedContent, savedMemories } = await processCloudMemorySaves(dynamodb, req.user.id, content);

                // Track usage from the non-streamed response
                await trackApiUsageAfterCall(req.user.id, provider, model, followUp, userInput);
                await saveCompressedData(dynamodb, req.user.id, userInput, cleanedContent, updateId);

                // Send as SSE
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no',
                });
                if (toolResults.length > 0) {
                    res.write(`data: ${JSON.stringify({ type: 'tools', tools: toolResults.map(t => ({ tool: t.tool, args: t.args, success: !t.result.startsWith('Error') })) })}\n\n`);
                }
                res.write(`data: ${JSON.stringify({ type: 'content', text: cleanedContent })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                needsStreaming = false;
                break;
            }
        }
    }

    if (!needsStreaming) return;

    // ── Streaming phase ──────────────────────────────────────────────────
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    // Send tool results first if any
    if (toolResults.length > 0) {
        res.write(`data: ${JSON.stringify({ type: 'tools', tools: toolResults.map(t => ({ tool: t.tool, args: t.args, success: !t.result.startsWith('Error') })) })}\n\n`);
    }

    // Remove tools for the streaming call (tools don't work with streaming)
    const streamOptions = { maxTokens, temperature: 0.7 };

    const providerConfig = PROVIDERS[provider];
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
        apiKey: githubToken,
        ...(providerConfig.baseURL ? { baseURL: providerConfig.baseURL } : {})
    });

    const stream = await client.chat.completions.create({
        model,
        messages,
        temperature: streamOptions.temperature,
        max_tokens: streamOptions.maxTokens,
        stream: true,
    });

    let fullContent = '';
    let chunkCount = 0;

    for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
            fullContent += delta;
            chunkCount++;
            res.write(`data: ${JSON.stringify({ type: 'token', text: delta })}\n\n`);
        }
    }

    // Process memory saves and finalize
    const { cleanedContent, savedMemories } = await processCloudMemorySaves(dynamodb, req.user.id, fullContent);

    // Build a synthetic response for usage tracking
    const promptTokens = Math.ceil(userInput.length / 4);
    const completionTokens = Math.ceil(fullContent.length / 4);
    const syntheticResponse = {
        choices: [{ message: { content: fullContent } }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    };
    await trackApiUsageAfterCall(req.user.id, provider, model, syntheticResponse, userInput);
    await saveCompressedData(dynamodb, req.user.id, userInput, cleanedContent, updateId);

    // Send cost estimate and token usage as metadata
    const cost = estimateCost(provider, model, promptTokens, completionTokens);
    res.write(`data: ${JSON.stringify({ type: 'meta', tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens }, cost })}\n\n`);

    // Generate auto-title for new conversations (fire-and-forget via SSE)
    let userMessage;
    try { userMessage = JSON.parse(userInput).message; } catch { userMessage = userInput; }
    const isFirstExchange = (() => {
        try { const p = JSON.parse(userInput); return !p.conversationHistory || p.conversationHistory.length <= 1; } catch { return true; }
    })();
    if (isFirstExchange && userMessage && cleanedContent) {
        const title = await generateConversationTitle(userMessage, cleanedContent, githubToken);
        if (title) {
            res.write(`data: ${JSON.stringify({ type: 'title', title })}\n\n`);
        }
    }

    // Log action
    try {
        let actionSummary = userMessage || userInput;
        if (actionSummary.length > 120) actionSummary = actionSummary.substring(0, 117) + '...';
        logAction(req.user.id, `Chat: ${actionSummary}`, 'net').catch(() => {});
    } catch {}

    res.write('data: [DONE]\n\n');
    res.end();

    console.log(`🌊 Streamed ${chunkCount} chunks in ${Date.now() - startValidation}ms`);
}

/**
 * Get maxTokens based on user's membership tier and model.
 * Free: 1000, Pro: 2000, Simple: 4000 (with model-specific ceilings)
 */
function getMaxTokensForRequest(user, model) {
    const text = user?.text || '';
    const rankMatch = text.match(/\|Rank:(\w+)/);
    const rank = rankMatch ? rankMatch[1] : 'Free';

    // Base limits by tier
    const tierLimits = { Free: 1000, Pro: 2000, Flex: 2000, Simple: 4000, Premium: 4000 };
    const tierMax = tierLimits[rank] || 1000;

    // Model-specific ceilings (some smaller models shouldn't get huge token budgets)
    const modelCeilings = {
        'gpt-4.1-nano': 1500,
        'Phi-4': 1500,
        'Mistral-small': 2000,
        'gpt-4o-mini': 3000,
        'gpt-4.1-mini': 3000,
        'claude-3.5-haiku': 3000,
    };

    const ceiling = modelCeilings[model];
    return ceiling ? Math.min(tierMax, ceiling) : tierMax;
}

module.exports = {
    parseCompressionRequest,
    validateApiUsage,
    callLLMApi,
    trackApiUsageAfterCall,
    saveCompressedData,
    processCompressionRequest,
    streamCompressionRequest,
    getMaxTokensForRequest,
    generateConversationTitle,
};
