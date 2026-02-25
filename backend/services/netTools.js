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
];

// ─── Tool Executors ─────────────────────────────────────────────────────────

/**
 * Execute a tool call and return a result string.
 * @param {string} toolName - Name of the tool
 * @param {object} args - Parsed arguments from the LLM
 * @param {object} context - { userId, userEmail, userName }
 * @returns {Promise<string>} Result message to feed back to the LLM
 */
async function executeTool(toolName, args, context) {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) {
    return `Error: Unknown tool "${toolName}". This tool is not available.`;
  }
  try {
    return await executor(args, context);
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
            <p>${description.replace(/\n/g, '<br/>')}</p>
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

    await createMemoryItem(context.userId, 'action', {
      title: `Note: ${title}`,
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
    const items = await getMemoryItems(context.userId, 'action');
    const notes = items.filter(a => a.data?.title?.startsWith('Note:'));

    if (notes.length === 0) {
      return 'You have no saved notes. You can save one by asking me to remember something.';
    }

    const list = notes.slice(-10).map((n, i) => {
      return `${i + 1}. ${n.data.title.replace('Note: ', '')}${n.data.description ? '\n   ' + n.data.description : ''}`;
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

  // ── Web search suggestion ─────────────────────────────────────────────────
  async web_search_suggestion(args) {
    const { query, reason } = args;
    const encoded = encodeURIComponent(query);
    return `I don't have real-time data for this. ${reason}\n\nSuggested search: [${query}](https://www.google.com/search?q=${encoded})`;
  },
};

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  TOOL_SCHEMAS,
  executeTool,
};
