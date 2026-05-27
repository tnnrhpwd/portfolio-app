/**
 * UI Automation tools (Microsoft UI Automation via System.Windows.Automation).
 *
 * Provides reliable, semantically-aware targeting of UI elements — far more
 * robust than pixel matching. Three tools:
 *   - uia_find    : find elements by name/automation-id/control-type
 *   - uia_invoke  : click/select/toggle an element
 *   - uia_get_text: read text from an element
 *
 * Snippets are kept short and emit JSON via ConvertTo-Json.
 */

const { spawn } = require('child_process');

const PS_TIMEOUT = 20_000;

function runPsJson(script) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', '-',
        ], { windowsHide: true });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d.toString('utf-8'));
        child.stderr.on('data', d => stderr += d.toString('utf-8'));
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, PS_TIMEOUT);
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(stderr.trim() || `powershell exited with ${code}`));
            try { resolve(JSON.parse(stdout || 'null')); } catch { resolve(stdout.trim()); }
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.stdin.write(script + '\n');
        child.stdin.end();
    });
}

const UIA_PRELUDE = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
function Find-Elements($name, $autoId, $ctrl, $max) {
    $conds = New-Object System.Collections.ArrayList
    if ($name)   { [void]$conds.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name))) }
    if ($autoId) { [void]$conds.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $autoId))) }
    if ($ctrl)   {
        $ct = [System.Windows.Automation.ControlType]::$ctrl
        if ($ct) { [void]$conds.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct))) }
    }
    if ($conds.Count -eq 0) { $cond = [System.Windows.Automation.Condition]::TrueCondition }
    elseif ($conds.Count -eq 1) { $cond = $conds[0] }
    else { $cond = New-Object System.Windows.Automation.AndCondition($conds.ToArray([System.Windows.Automation.Condition])) }
    $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $out = @()
    for ($i = 0; $i -lt [Math]::Min($found.Count, $max); $i++) {
        $e = $found[$i]
        try {
            $bounds = $e.Current.BoundingRectangle
            $out += [pscustomobject]@{
                name = $e.Current.Name
                automationId = $e.Current.AutomationId
                controlType = $e.Current.ControlType.ProgrammaticName
                className = $e.Current.ClassName
                runtimeId = ([System.Windows.Automation.AutomationElement]::RuntimeIdProperty | ForEach-Object { ($e.GetRuntimeId() -join ',') })
                x = [int]$bounds.X; y = [int]$bounds.Y
                width = [int]$bounds.Width; height = [int]$bounds.Height
                enabled = $e.Current.IsEnabled
                offscreen = $e.Current.IsOffscreen
            }
        } catch {}
    }
    $out
}
`.trim();

function quote(s) { return "'" + String(s || '').replace(/'/g, "''") + "'"; }

const uiaFind = {
    name: 'uia_find',
    category: 'safe-read',
    description:
        'Find UI elements via Microsoft UI Automation. At least one of name, automationId, controlType is required. ' +
        'Returns up to `max` matches with bounding-rectangle coordinates suitable for `uia_invoke` or pixel actions.',
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            automationId: { type: 'string' },
            controlType: { type: 'string', description: 'e.g. Button, Edit, Hyperlink, MenuItem, TabItem, Window' },
            max: { type: 'integer' },
        },
    },
    async run(args) {
        if (!args.name && !args.automationId && !args.controlType) {
            throw new Error('Provide at least one of name, automationId, controlType');
        }
        const max = Math.min(50, Math.max(1, Number(args.max) || 10));
        const script = `${UIA_PRELUDE}
$r = Find-Elements ${quote(args.name)} ${quote(args.automationId)} ${quote(args.controlType)} ${max}
$r | ConvertTo-Json -Compress -Depth 4
        `.trim();
        const res = await runPsJson(script);
        const arr = Array.isArray(res) ? res : (res ? [res] : []);
        return { count: arr.length, elements: arr };
    },
};

const uiaInvoke = {
    name: 'uia_invoke',
    category: 'system',
    description:
        'Invoke an action on the first matching UI element: click a button, toggle a checkbox, select a list item. ' +
        'Specify the same filters as uia_find; the first match is acted on.',
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            automationId: { type: 'string' },
            controlType: { type: 'string' },
            action: { type: 'string', enum: ['invoke', 'toggle', 'select', 'expand', 'collapse', 'focus'], description: 'Default invoke.' },
        },
    },
    async run(args) {
        if (!args.name && !args.automationId && !args.controlType) {
            throw new Error('Provide at least one of name, automationId, controlType');
        }
        const action = args.action || 'invoke';
        const script = `${UIA_PRELUDE}
$els = Find-Elements ${quote(args.name)} ${quote(args.automationId)} ${quote(args.controlType)} 1
if ($els.Count -eq 0) { Write-Error 'no element matched'; exit 1 }
$rt = $els[0].runtimeId.Split(',') | ForEach-Object { [int]$_ }
$conds = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::RuntimeIdProperty,
    [int[]]$rt)
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $conds)
if (-not $el) { Write-Error 'lost element after match'; exit 1 }
switch ('${action}') {
    'invoke'   { $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern);  $p.Invoke() }
    'toggle'   { $p = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern);  $p.Toggle() }
    'select'   { $p = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern); $p.Select() }
    'expand'   { $p = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); $p.Expand() }
    'collapse' { $p = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); $p.Collapse() }
    'focus'    { $el.SetFocus() }
}
[pscustomobject]@{ ok = $true; name = $el.Current.Name; action = '${action}' } | ConvertTo-Json -Compress
        `.trim();
        return await runPsJson(script);
    },
    async dryRun(args) { return { dryRun: true, would: { action: args.action || 'invoke', filters: args } }; },
};

const uiaGetText = {
    name: 'uia_get_text',
    category: 'safe-read',
    description: 'Read the text/value of a UI element (TextBox, Label, Document, etc.).',
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            automationId: { type: 'string' },
            controlType: { type: 'string' },
        },
    },
    async run(args) {
        const script = `${UIA_PRELUDE}
$els = Find-Elements ${quote(args.name)} ${quote(args.automationId)} ${quote(args.controlType)} 1
if ($els.Count -eq 0) { Write-Error 'no element matched'; exit 1 }
$rt = $els[0].runtimeId.Split(',') | ForEach-Object { [int]$_ }
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::RuntimeIdProperty, [int[]]$rt)
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
$text = $null
try { $p = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $text = $p.Current.Value } catch {}
if (-not $text) { try { $p = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern); $text = $p.DocumentRange.GetText(8192) } catch {} }
if (-not $text) { $text = $el.Current.Name }
[pscustomobject]@{ name = $el.Current.Name; text = $text } | ConvertTo-Json -Compress
        `.trim();
        return await runPsJson(script);
    },
};

module.exports = { uiaFind, uiaInvoke, uiaGetText };
