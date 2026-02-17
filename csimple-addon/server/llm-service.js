const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class LlmService {
  constructor(options = {}) {
    this.pythonScript = options.pythonScript;
    this.projectRoot = options.projectRoot;
    this.currentProcess = null;

    // Resolve Python executable
    this.pythonExe = this._findPython();

    // HuggingFace models directory
    this.hfModelsPath = this._resolveHFModelsPath();

    console.log(`[LlmService] Python: ${this.pythonExe}`);
    console.log(`[LlmService] Script: ${this.pythonScript}`);
    console.log(`[LlmService] Models: ${this.hfModelsPath}`);
  }

  _findPython() {
    // Check common Python locations on Windows
    const candidates = ['python', 'python3', 'py'];
    for (const cmd of candidates) {
      try {
        const result = require('child_process').execSync(`${cmd} --version`, {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (result.includes('Python 3')) {
          return cmd;
        }
      } catch {
        // Try next candidate
      }
    }
    return 'python'; // Fallback
  }

  _resolveHFModelsPath() {
    // Match the C# AppPathService logic: BasePath/Resources/HFModels
    // The MAUI app typically stores data in AppData/Local
    const possiblePaths = [
      // Development path (relative to project)
      path.join(this.projectRoot, 'Resources', 'HFModels'),
      // Standard HuggingFace cache
      path.join(os.homedir(), '.cache', 'huggingface', 'hub'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    // Create default path
    const defaultPath = path.join(this.projectRoot, 'Resources', 'HFModels');
    try {
      fs.mkdirSync(defaultPath, { recursive: true });
    } catch { /* ignore */ }
    return defaultPath;
  }

  /**
   * Run a chat inference with the local LLM
   */
  async chat({ message, modelId, systemPrompt, temperature, topP, maxLength, conversationHistory, onProgress }) {
    const startTime = Date.now();

    // Build the full prompt with conversation history and system prompt
    const fullPrompt = this._buildPrompt(message, systemPrompt, conversationHistory);

    // Resolve local model path if available
    const localModelPath = this._findLocalModel(modelId);

    return new Promise((resolve, reject) => {
      const args = [
        this.pythonScript,
        '--model_id', modelId,
        '--input', fullPrompt,
        '--max_length', String(maxLength),
        '--temperature', String(temperature),
        '--top_p', String(topP),
      ];

      if (localModelPath) {
        args.push('--local_model_path', localModelPath);
      }

      console.log(`[LlmService] Spawning: ${this.pythonExe} ${args.slice(0, 3).join(' ')} ...`);

      const proc = spawn(this.pythonExe, args, {
        cwd: path.dirname(this.pythonScript),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        timeout: 300000, // 5 minute timeout
      });

      this.currentProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;

        // Log key stderr lines for debugging
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (line.includes('✓') || line.includes('⚠') || line.includes('❌') || 
              line.includes('ERROR') || line.includes('COMPLETED') || line.includes('CRITICAL') ||
              line.includes('Model loaded') || line.includes('downloaded')) {
            console.log(`[Python] ${line.trim()}`);
          }
        }

        // Parse progress from stderr for streaming updates
        if (onProgress) {
          for (const line of lines) {
            if (line.includes('Loading') || line.includes('Generating') || line.includes('Processing')) {
              onProgress(line.trim());
            }
          }
        }
      });

      proc.on('close', (code) => {
        this.currentProcess = null;
        const generationTime = ((Date.now() - startTime) / 1000).toFixed(2);

        if (code === 0 && stdout.trim()) {
          resolve({
            text: stdout.trim(),
            generationTime: `${generationTime}s`,
          });
        } else if (code === null) {
          // Process was killed (stopped by user)
          resolve({
            text: '[Generation stopped]',
            generationTime: `${generationTime}s`,
          });
        } else {
          // Try to extract useful error from stderr
          const errorLines = stderr.split('\n').filter(l =>
            l.includes('Error') || l.includes('error') || l.includes('Exception')
          );
          const errorMsg = errorLines.length > 0
            ? errorLines[errorLines.length - 1].trim()
            : `Python process exited with code ${code}`;

          reject(new Error(errorMsg));
        }
      });

      proc.on('error', (err) => {
        this.currentProcess = null;
        reject(new Error(`Failed to start Python: ${err.message}. Is Python installed?`));
      });
    });
  }

  /**
   * Build a formatted prompt with system prompt and conversation history
   */
  _buildPrompt(message, systemPrompt, conversationHistory) {
    const parts = [];

    if (systemPrompt && systemPrompt.trim()) {
      parts.push(`<|im_start|>system\n${systemPrompt.trim()}<|im_end|>`);
    }

    // Add conversation history (last 10 exchanges to avoid token overflow)
    const recentHistory = conversationHistory.slice(-20);
    for (const msg of recentHistory) {
      const role = msg.role === 'user' ? 'user' : 'assistant';
      parts.push(`<|im_start|>${role}\n${msg.content}<|im_end|>`);
    }

    // Add current message
    parts.push(`<|im_start|>user\n${message}<|im_end|>`);
    parts.push('<|im_start|>assistant\n');

    return parts.join('\n');
  }

  /**
   * Find locally downloaded model path (only returns paths with actual model files)
   */
  _findLocalModel(modelId) {
    const sanitizedId = modelId.replace(/\//g, '--');
    const possiblePaths = [
      path.join(this.hfModelsPath, sanitizedId),
      path.join(this.hfModelsPath, modelId.split('/').pop()),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        // Verify it contains actual model files (not just HF cache structure)
        try {
          const files = fs.readdirSync(p);
          const hasModelFiles = files.some(f =>
            f.endsWith('.bin') || f.endsWith('.safetensors') || f === 'config.json'
          );
          if (hasModelFiles) {
            return p;
          }
        } catch { /* ignore */ }
      }
    }

    return null;
  }

  /**
   * Stop current generation
   */
  stopCurrentGeneration() {
    if (this.currentProcess) {
      console.log('[LlmService] Stopping current generation...');
      this.currentProcess.kill('SIGTERM');
      setTimeout(() => {
        if (this.currentProcess) {
          this.currentProcess.kill('SIGKILL');
        }
      }, 3000);
    }
  }

  /**
   * List available models from local directory and defaults
   */
  async listAvailableModels() {
    const models = [...this.getDefaultModels()];
    const seen = new Set(models.map(m => m.id));

    // Scan HFModels directory
    try {
      if (fs.existsSync(this.hfModelsPath)) {
        const entries = fs.readdirSync(this.hfModelsPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const modelId = entry.name.replace(/--/g, '/');
            if (!seen.has(modelId)) {
              models.push({
                id: modelId,
                name: entry.name,
                local: true,
                description: 'Locally downloaded model',
              });
            }
          }
        }
      }
    } catch { /* ignore */ }

    // Scan HuggingFace cache
    try {
      const hfCache = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
      if (fs.existsSync(hfCache)) {
        const entries = fs.readdirSync(hfCache, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith('models--')) {
            const modelId = entry.name.replace('models--', '').replace(/--/g, '/');
            if (!seen.has(modelId)) {
              seen.add(modelId);
              models.push({
                id: modelId,
                name: modelId,
                local: true,
                description: 'Cached in HuggingFace hub',
              });
            }
          }
        }
      }
    } catch { /* ignore */ }

    return models;
  }

  /**
   * Default models that are commonly available
   */
  getDefaultModels() {
    return [
      {
        id: 'gpt2',
        name: 'GPT-2',
        local: false,
        description: 'OpenAI GPT-2 (small, fast, 124M params)',
        category: 'text-generation',
      },
      {
        id: 'Qwen/Qwen2.5-0.5B-Instruct',
        name: 'Qwen 2.5 0.5B',
        local: false,
        description: 'Qwen 2.5 Instruct (0.5B, fast, good quality)',
        category: 'text-generation',
      },
      {
        id: 'Qwen/Qwen2.5-1.5B-Instruct',
        name: 'Qwen 2.5 1.5B',
        local: false,
        description: 'Qwen 2.5 Instruct (1.5B, balanced)',
        category: 'text-generation',
      },
      {
        id: 'microsoft/DialoGPT-medium',
        name: 'DialoGPT Medium',
        local: false,
        description: 'Microsoft DialoGPT for conversations',
        category: 'text-generation',
      },
      {
        id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
        name: 'TinyLlama 1.1B Chat',
        local: false,
        description: 'TinyLlama chat model (1.1B, efficient)',
        category: 'text-generation',
      },
      {
        id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
        name: 'DeepSeek R1 1.5B',
        local: false,
        description: 'DeepSeek R1 distilled (1.5B, reasoning)',
        category: 'text-generation',
      },
    ];
  }
}

module.exports = { LlmService };
