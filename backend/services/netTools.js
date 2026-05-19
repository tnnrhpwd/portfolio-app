/**
 * Net Tools — LLM function-calling tools for /net chat.
 *
 * The LLM decides when to call these tools based on the user's message.
 * Each tool has:
 *   - A schema (OpenAI function-calling format) sent to the LLM
 *   - An execute() function that runs server-side and returns a result string
 *
 * To add a new tool:
 *   1. Add its schema to TOOL_SCHEMAS
 *   2. Add its execute() to TOOL_EXECUTORS
 *   3. The LLM will automatically decide when to use it
 */

const { sendEmail } = require('./emailService');
const { createMemoryItem, getMemoryItems, getGoalsSummary } = require('./memoryService');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

// Local DynamoDB client for memory/personality/behavior tool writes.
// (Mirrors memoryService.js so tools can run without needing the caller
// to thread a client through toolContext.)
const _ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const _dynamodb = DynamoDBDocumentClient.from(_ddbClient);
const CSIMPLE_CREATED_AT = '2000-01-01T00:00:00.000Z';
const MAX_FILE_BYTES = 32 * 1024;
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_\-. ()]{1,100}$/;
const PERSONALITY_FILES = ['identity.md', 'soul.md', 'user.md'];

// ─── Tool Schemas (OpenAI function-calling format) ──────────────────────────

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'submit_support_ticket',
      description: 'Submit a support ticket or feature request to the site administrator. Use this when the user wants to report a bug, request a feature, suggest an improvement, or needs help with something that requires human attention.',
      parameters: {
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description: 'Brief subject line for the ticket (max 120 chars)',
          },
          description: {
            type: 'string',
            description: 'Detailed description of the issue, feature request, or suggestion',
          },
          category: {
            type: 'string',
            enum: ['bug', 'feature_request', 'improvement', 'question', 'other'],
            description: 'Category of the ticket',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Priority level. Use high only for blocking issues.',
          },
        },
        required: ['subject', 'description', 'category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_goal',
      description: 'Save a new goal for the user. Use this when the user expresses a goal, objective, resolution, or something they want to achieve or track progress on.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short title for the goal (max 120 chars)',
          },
          description: {
            type: 'string',
            description: 'Detailed description of what the user wants to achieve',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Priority level of the goal',
          },
          deadline: {
            type: 'string',
            description: 'Optional deadline in ISO 8601 format or natural language (e.g. "2026-03-01" or "end of month")',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_note',
      description: 'Save a note or piece of information the user wants to remember. Use this when the user asks to remember something, save a note, bookmark an idea, or store information for later.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short title or summary of the note',
          },
          content: {
            type: 'string',
            description: 'The full content of the note',
          },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_goals',
      description: 'Retrieve the user\'s current goals and plans. Use this when the user asks about their goals, progress, plans, or what they\'re working on.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_notes',
      description: 'Retrieve the user\'s saved notes. Use this when the user asks about their notes, saved information, or something they previously stored.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_action',
      description: 'Log an action the user has completed or plans to take. Use this when the user reports completing a task, starting an activity, or making progress on something.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of the action taken (max 120 chars)',
          },
        },
        required: ['summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search_suggestion',
      description: 'Suggest a web search when the user needs real-time information, current events, prices, weather, or anything that requires up-to-date data you don\'t have.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The suggested search query',
          },
          reason: {
            type: 'string',
            description: 'Brief explanation of why a search would help',
          },
        },
        required: ['query', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_conversation',
      description: 'Summarize the current conversation into a concise recap. Use this when the conversation is long and the user asks for a summary, or to compress context before continuing a complex discussion.',
      parameters: {
        type: 'object',
        properties: {
          highlights: {
            type: 'string',
            description: 'Key topics, decisions, or action items from the conversation so far (max 2000 chars)',
          },
          next_steps: {
            type: 'string',
            description: 'Suggested next steps or open questions',
          },
        },
        required: ['highlights'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Evaluate a mathematical expression and return the result. Use this for arithmetic, unit conversions, percentages, or any numeric computation the user requests.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'A mathematical expression to evaluate (e.g. "2 * (3 + 4)", "15% of 200", "sqrt(144)")',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_datetime',
      description: 'Get the current date and time. Use this when the user asks what time/date it is, or when you need to determine the current date for deadline calculations or scheduling.',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'IANA timezone name (e.g. "America/New_York", "Europe/London"). Defaults to UTC.',
          },
        },
        required: [],
      },
    },
  },

  // ── Memory / Personality / Behavior Auto-Management Tools ─────────────
  // Mirror the addon's OpenClaude-style autonomous-memory tools so the
  // cloud chat path has feature parity for users without the addon.
  {
    type: 'function',
    function: {
      name: 'update_memory',
      description: 'Create or update a memory file to persist knowledge across conversations. Use this proactively when the user shares personal info (name, preferences, projects, relationships, goals, job, location, important dates), or when you learn something worth remembering. Memories survive across sessions. Use descriptive filenames like "user_preferences.md", "project_notes.md", "important_dates.md". READ existing memory first (from the MEMORY section in your context) before writing to avoid overwriting — merge new info with existing content.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Memory filename (e.g. "user_preferences.md", "projects.md"). Use .md extension.' },
          content: { type: 'string', description: 'Full content of the memory file. If updating, include ALL existing content plus new additions — this overwrites the file.' },
          reason: { type: 'string', description: 'Brief internal note for why this memory is being saved (not shown to user).' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_memory',
      description: 'Delete a memory file that is no longer relevant or accurate.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Memory filename to delete' },
        },
        required: ['filename'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_personality',
      description: 'Update a personality file that defines your character and behavior. Files: "identity.md" (who you are, your name, tone, style), "soul.md" (core values, principles, emotional disposition), "user.md" (what you know about this specific user — their communication style, how they like to be addressed, relationship context). Update these when the user asks you to change how you behave, adopt a persona, remember their preferences for interaction style, or when you discover meaningful patterns about how they communicate.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', enum: ['identity.md', 'soul.md', 'user.md'], description: 'Which personality file to update' },
          content: { type: 'string', description: 'Full replacement content for the personality file.' },
          reason: { type: 'string', description: 'Brief note for why this personality update is happening.' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_behavior',
      description: 'Create or update a behavior file that provides high-level instructions for how you should operate. Behaviors are like custom instruction sets — e.g. "coding_assistant.txt" might say "Always provide code examples, prefer TypeScript, explain tradeoffs". Update behaviors when the user wants to customize how you respond for specific contexts or tasks.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Behavior filename (e.g. "default.txt", "coding_mode.txt"). Use .txt extension.' },
          content: { type: 'string', description: 'Full content of the behavior file — instructions for how you should act.' },
          reason: { type: 'string', description: 'Brief note for why this behavior is being updated.' },
        },
        required: ['filename', 'content'],
      },
    },
  },
];

// ─── Tool Executors ─────────────────────────────────────────────────────────

/**
 * Execute a tool call and return a result string.
 * @param {string} toolName - Name of the tool
 * @param {object} args - Parsed arguments from the LLM
 * @param {object} context - { userId, userEmail, userName }
 * @returns {Promise<string>} Result message to feed back to the LLM
 */
// ─── Input length limits per field ────────────────────────────────────────────
const MAX_LENGTHS = {
  subject: 200,
  description: 5000,
  title: 200,
  content: 30000,
  filename: 100,
  summary: 300,
  query: 500,
  reason: 500,
  deadline: 100,
  highlights: 2000,
  next_steps: 500,
  expression: 200,
  timezone: 50,
};

/**
 * Truncate arguments that exceed safe limits.
 * Prevents abuse via extremely long payloads.
 */
function enforceArgLimits(args) {
  if (!args || typeof args !== 'object') return args;
  const safe = { ...args };
  for (const [key, maxLen] of Object.entries(MAX_LENGTHS)) {
    if (typeof safe[key] === 'string' && safe[key].length > maxLen) {
      console.warn(`[netTools] Truncating argument "${key}" from ${safe[key].length} to ${maxLen} chars`);
      safe[key] = safe[key].slice(0, maxLen);
    }
  }
  return safe;
}

async function executeTool(toolName, args, context) {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) {
    return `Error: Unknown tool "${toolName}". This tool is not available.`;
  }
  try {
    const safeArgs = enforceArgLimits(args);
    return await executor(safeArgs, context);
  } catch (err) {
    console.error(`[netTools] Error executing tool "${toolName}":`, err);
    return `Error executing ${toolName}: ${err.message}`;
  }
}

const TOOL_EXECUTORS = {
  // ── Submit support ticket ───────────────────────────────────────────────
  async submit_support_ticket(args, context) {
    const { subject, description, category, priority = 'medium' } = args;
    const adminEmail = process.env.FROM_EMAIL || 'admin@sthopwood.com';

    // Save as a memory item so it's tracked
    await createMemoryItem(context.userId, 'action', {
      title: `Support ticket: ${subject}`,
      source: 'net-tool',
      category,
      priority,
      timestamp: new Date().toISOString(),
    });

    // Send email notification to admin
    try {
      const postmark = require('postmark');
      let client = null;
      if (process.env.POSTMARK_API_TOKEN) {
        client = new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);
        await client.sendEmail({
          From: adminEmail,
          To: adminEmail,
          Subject: `[${category.toUpperCase()}] ${subject}`,
          HtmlBody: `
            <h2>Support Ticket from /net</h2>
            <p><strong>From:</strong> ${context.userName || 'Unknown'} (${context.userEmail || 'no email'})</p>
            <p><strong>User ID:</strong> ${context.userId}</p>
            <p><strong>Category:</strong> ${category}</p>
            <p><strong>Priority:</strong> ${priority}</p>
            <hr />
            <p>${description.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])).replace(/\n/g, '<br/>')}</p>
            <hr />
            <p><em>Submitted via /net AI chat tool</em></p>
          `,
          TextBody: `Support Ticket from /net\n\nFrom: ${context.userName || 'Unknown'} (${context.userEmail || 'no email'})\nUser ID: ${context.userId}\nCategory: ${category}\nPriority: ${priority}\n\n${description}\n\nSubmitted via /net AI chat tool`,
          MessageStream: 'outbound',
        });
      }
    } catch (emailErr) {
      console.warn('[netTools] Email notification failed:', emailErr.message);
      // Don't fail the whole tool — ticket is still logged
    }

    return `Support ticket submitted successfully.\n- Subject: ${subject}\n- Category: ${category}\n- Priority: ${priority}\nThe site administrator has been notified.`;
  },

  // ── Save goal ─────────────────────────────────────────────────────────────
  async save_goal(args, context) {
    const { title, description = '', priority = 'medium', deadline = null } = args;

    await createMemoryItem(context.userId, 'goal', {
      title,
      description,
      priority,
      deadline,
      status: 'active',
      timestamp: new Date().toISOString(),
    });

    return `Goal saved: "${title}"${deadline ? ` (deadline: ${deadline})` : ''}. You can view your goals on the /plans page.`;
  },

  // ── Save note ─────────────────────────────────────────────────────────────
  async save_note(args, context) {
    const { title, content } = args;

    await createMemoryItem(context.userId, 'note', {
      title,
      description: content,
      source: 'net-tool',
      timestamp: new Date().toISOString(),
    });

    return `Note saved: "${title}". You can view your notes on the /plans page.`;
  },

  // ── Get goals ─────────────────────────────────────────────────────────────
  async get_my_goals(args, context) {
    const items = await getMemoryItems(context.userId, 'goal');
    const active = items.filter(g => g.data?.status === 'active');

    if (active.length === 0) {
      return 'You have no active goals. You can set one by telling me what you want to achieve.';
    }

    const list = active.map((g, i) => {
      const parts = [`${i + 1}. ${g.data.title}`];
      if (g.data.description) parts.push(`   ${g.data.description}`);
      if (g.data.deadline) parts.push(`   Deadline: ${g.data.deadline}`);
      if (g.data.priority) parts.push(`   Priority: ${g.data.priority}`);
      return parts.join('\n');
    }).join('\n');

    return `Your active goals:\n${list}`;
  },

  // ── Get notes ─────────────────────────────────────────────────────────────
  async get_my_notes(args, context) {
    // Fetch dedicated 'note' type items, with backward-compat fallback for
    // legacy notes stored as type 'action' with a "Note:" title prefix.
    const noteItems = await getMemoryItems(context.userId, 'note');
    const legacyActions = await getMemoryItems(context.userId, 'action');
    const legacyNotes = legacyActions.filter(a => a.data?.title?.startsWith('Note:'));

    // Merge and deduplicate (legacy items won't have the same ids)
    const allNotes = [...noteItems, ...legacyNotes];

    if (allNotes.length === 0) {
      return 'You have no saved notes. You can save one by asking me to remember something.';
    }

    // Sort newest first, take last 10
    allNotes.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const list = allNotes.slice(0, 10).map((n, i) => {
      const title = (n.data.title || '').replace(/^Note:\s*/, '');
      return `${i + 1}. ${title}${n.data.description ? '\n   ' + n.data.description : ''}`;
    }).join('\n');

    return `Your recent notes:\n${list}`;
  },

  // ── Log action ────────────────────────────────────────────────────────────
  async log_action(args, context) {
    const { summary } = args;
    const { logAction } = require('./memoryService');

    await logAction(context.userId, summary, 'net-tool');
    return `Action logged: "${summary}". You can view your action history on the /plans page.`;
  },

  // ── Web search ────────────────────────────────────────────────────────────
  // Performs a real web search when BRAVE_SEARCH_API_KEY is configured,
  // otherwise falls back to a Google search URL suggestion.
  async web_search_suggestion(args) {
    const { query, reason } = args;
    const encoded = encodeURIComponent(query);

    // Try Brave Search API if configured
    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    if (braveKey) {
      try {
        const res = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=5`,
          { headers: { 'X-Subscription-Token': braveKey, Accept: 'application/json' } }
        );
        if (res.ok) {
          const data = await res.json();
          const results = (data.web?.results || []).slice(0, 5);
          if (results.length > 0) {
            const list = results.map((r, i) =>
              `${i + 1}. ${r.title}\n   ${r.description || ''}\n   ${r.url}`
            ).join('\n');
            return `Search results for "${query}":\n${list}`;
          }
        }
      } catch (err) {
        // Fall through to suggestion fallback
        console.error('Brave Search API error:', err.message);
      }
    }

    // Fallback: return a clickable Google search link
    return `I don't have real-time data for this. ${reason}\n\nSuggested search: [${query}](https://www.google.com/search?q=${encoded})`;
  },

  // ── Summarize conversation ──────────────────────────────────────────────
  async summarize_conversation(args, context) {
    const { highlights, next_steps = '' } = args;

    // Save as a note so the user can reference it later
    await createMemoryItem(context.userId, 'note', {
      title: 'Conversation Summary',
      description: highlights + (next_steps ? `\n\nNext steps: ${next_steps}` : ''),
      source: 'net-tool',
      timestamp: new Date().toISOString(),
    });

    let result = `**Conversation Summary**\n\n${highlights}`;
    if (next_steps) result += `\n\n**Next Steps:** ${next_steps}`;
    result += '\n\n_This summary has been saved to your notes._';
    return result;
  },

  // ── Calculate ─────────────────────────────────────────────────────────────
  async calculate(args) {
    const { expression } = args;
    // Sanitize: only allow digits, math operators, parentheses, dots, spaces,
    // and a few common math functions
    const sanitized = expression.replace(/\s+/g, ' ').trim();
    const SAFE_PATTERN = /^[0-9+\-*/().,%^ sqrtlognabcepitMhfloceir]+$/;
    if (!SAFE_PATTERN.test(sanitized)) {
      return `Cannot evaluate expression: contains unsupported characters. Please use standard math notation.`;
    }

    // Replace common math shorthand
    let expr = sanitized
      .replace(/(\d+(?:\.\d+)?)%\s*of\s*(\d+(?:\.\d+)?)/gi, '($1/100)*$2')
      .replace(/sqrt\(/gi, 'Math.sqrt(')
      .replace(/log\(/gi, 'Math.log10(')
      .replace(/ln\(/gi, 'Math.log(')
      .replace(/abs\(/gi, 'Math.abs(')
      .replace(/ceil\(/gi, 'Math.ceil(')
      .replace(/floor\(/gi, 'Math.floor(')
      .replace(/\bpi\b/gi, 'Math.PI')
      .replace(/\be\b/g, 'Math.E')
      .replace(/\^/g, '**');

    // Block anything that looks like code injection
    if (/[a-zA-Z_$]/.test(expr.replace(/Math\.(sqrt|log10|log|abs|ceil|floor|PI|E|pow)/g, ''))) {
      return `Cannot evaluate: expression contains non-math identifiers. Please use numbers and standard operators.`;
    }

    try {
      // Use Function constructor in a restricted way (no access to globals)
      const fn = new Function(`"use strict"; return (${expr});`);
      const result = fn();
      if (typeof result !== 'number' || !isFinite(result)) {
        return `Result is not a finite number. Check your expression.`;
      }
      return `${expression} = ${result}`;
    } catch (err) {
      return `Error evaluating "${expression}": ${err.message}`;
    }
  },

  // ── Get current date/time ─────────────────────────────────────────────────
  async get_current_datetime(args) {
    const { timezone = 'UTC' } = args;
    try {
      const now = new Date();
      const formatted = now.toLocaleString('en-US', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
      return `Current date and time (${timezone}): ${formatted}`;
    } catch {
      // Fallback to UTC if invalid timezone
      return `Current date and time (UTC): ${new Date().toISOString()}`;
    }
  },

  // ── Update memory (cloud equivalent of addon's update_memory) ────────────
  async update_memory(args, context) {
    const { filename, content } = args;
    if (!context?.userId) return 'Error: user context missing.';
    if (!filename || !SAFE_FILENAME_RE.test(filename)) {
      return `Error: invalid filename "${filename}". Use alphanumerics, dots, hyphens, underscores, spaces, or parentheses (max 100 chars).`;
    }
    if (Buffer.byteLength(content || '', 'utf-8') > MAX_FILE_BYTES) {
      return `Error: memory file too large (max ${MAX_FILE_BYTES} bytes).`;
    }
    try {
      const itemId = `csimple_memory_${context.userId}_${filename}`;
      let isUpdate = false;
      try {
        const { Item } = await _dynamodb.send(new GetCommand({
          TableName: 'Simple',
          Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
        }));
        isUpdate = !!Item;
      } catch { /* ignore */ }
      await _dynamodb.send(new PutCommand({
        TableName: 'Simple',
        Item: {
          id: itemId,
          text: content || '',
          createdAt: CSIMPLE_CREATED_AT,
          updatedAt: new Date().toISOString(),
        },
      }));
      return `Memory ${isUpdate ? 'updated' : 'created'}: ${filename}`;
    } catch (err) {
      return `Error saving memory "${filename}": ${err.message}`;
    }
  },

  // ── Delete memory ─────────────────────────────────────────────────────────
  async delete_memory(args, context) {
    const { filename } = args;
    if (!context?.userId) return 'Error: user context missing.';
    if (!filename || !SAFE_FILENAME_RE.test(filename)) {
      return `Error: invalid filename "${filename}".`;
    }
    try {
      const itemId = `csimple_memory_${context.userId}_${filename}`;
      await _dynamodb.send(new DeleteCommand({
        TableName: 'Simple',
        Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
      }));
      return `Memory deleted: ${filename}`;
    } catch (err) {
      return `Error deleting memory "${filename}": ${err.message}`;
    }
  },

  // ── Update personality ───────────────────────────────────────────────────
  async update_personality(args, context) {
    const { filename, content } = args;
    if (!context?.userId) return 'Error: user context missing.';
    if (!PERSONALITY_FILES.includes(filename)) {
      return `Error: personality filename must be one of: ${PERSONALITY_FILES.join(', ')}.`;
    }
    if (Buffer.byteLength(content || '', 'utf-8') > MAX_FILE_BYTES) {
      return `Error: personality file too large (max ${MAX_FILE_BYTES} bytes).`;
    }
    try {
      const itemId = `csimple_personality_${context.userId}_${filename}`;
      await _dynamodb.send(new PutCommand({
        TableName: 'Simple',
        Item: {
          id: itemId,
          text: content || '',
          createdAt: CSIMPLE_CREATED_AT,
          updatedAt: new Date().toISOString(),
        },
      }));
      return `Personality updated: ${filename}`;
    } catch (err) {
      return `Error saving personality "${filename}": ${err.message}`;
    }
  },

  // ── Update behavior ──────────────────────────────────────────────────────
  async update_behavior(args, context) {
    const { filename, content } = args;
    if (!context?.userId) return 'Error: user context missing.';
    if (!filename || !SAFE_FILENAME_RE.test(filename)) {
      return `Error: invalid filename "${filename}".`;
    }
    if (Buffer.byteLength(content || '', 'utf-8') > MAX_FILE_BYTES) {
      return `Error: behavior file too large (max ${MAX_FILE_BYTES} bytes).`;
    }
    try {
      const itemId = `csimple_behavior_${context.userId}_${filename}`;
      let isUpdate = false;
      try {
        const { Item } = await _dynamodb.send(new GetCommand({
          TableName: 'Simple',
          Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
        }));
        isUpdate = !!Item;
      } catch { /* ignore */ }
      await _dynamodb.send(new PutCommand({
        TableName: 'Simple',
        Item: {
          id: itemId,
          text: content || '',
          createdAt: CSIMPLE_CREATED_AT,
          updatedAt: new Date().toISOString(),
        },
      }));
      return `Behavior ${isUpdate ? 'updated' : 'created'}: ${filename}`;
    } catch (err) {
      return `Error saving behavior "${filename}": ${err.message}`;
    }
  },
};

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  TOOL_SCHEMAS,
  executeTool,
};
