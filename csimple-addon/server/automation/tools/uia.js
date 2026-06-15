/**
 * UI Automation tools (Microsoft UI Automation via System.Windows.Automation).
 *
 * Provides reliable, semantically-aware targeting of UI elements — far more
 * robust than pixel matching. Four tools:
 *   - uia_find     : find elements by name/automation-id/control-type
 *   - uia_invoke   : click/select/toggle an element
 *   - uia_get_text : read text from an element
 *   - uia_snapshot : capture the foreground (or named) window's accessibility
 *                    tree as a compact JSON the agent can reason over
 *
 * Snippets are kept short and emit JSON via ConvertTo-Json.
 */

const { runPsJson, runPsJsonFile } = require('../ps-runner');

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

const uiaSnapshot = {
    name: 'uia_snapshot',
    category: 'safe-read',
    description:
        'Capture the accessibility tree of the foreground (or named) window as a compact JSON. ' +
        'Use this to "see" what the user is looking at before deciding which uia_find/uia_invoke call to make. ' +
        'Filters offscreen elements by default. ' +
        'When `mode="interactive"`, returns ONLY actionable controls (Button, Edit, Hyperlink, ListItem, MenuItem, CheckBox, RadioButton, Tab, ComboBox) — much smaller payload, ideal for first-pass agent reasoning.',
    parameters: {
        type: 'object',
        properties: {
            windowName: { type: 'string', description: 'If provided, snapshot the first top-level window whose name matches this substring; otherwise the foreground window.' },
            mode: { type: 'string', enum: ['tree', 'interactive', 'flat'], description: 'tree=full hierarchy; interactive=actionable controls only (default); flat=flat list of all visible nodes.' },
            maxNodes: { type: 'integer', description: 'Hard cap on number of nodes returned (default 250, max 1000).' },
            maxDepth: { type: 'integer', description: 'Tree depth cutoff (default 12).' },
            includeOffscreen: { type: 'boolean', description: 'Include nodes flagged IsOffscreen (default false).' },
        },
    },
    async run(args = {}) {
        const mode = ['tree', 'interactive', 'flat'].includes(args.mode) ? args.mode : 'interactive';
        const maxNodes = Math.min(1000, Math.max(10, Number(args.maxNodes) || 250));
        const maxDepth = Math.min(40, Math.max(1, Number(args.maxDepth) || 12));
        const includeOffscreen = !!args.includeOffscreen;
        const windowName = String(args.windowName || '');

        // PowerShell script: locate the target window, then walk its ControlView
        // tree breadth-first, emitting either a full nested tree, a flat list, or
        // only "interactive" controls.
        const script = `${UIA_PRELUDE}
$ErrorActionPreference = 'SilentlyContinue'

# Resolve target window
$target = $null
$windowName = ${quote(windowName)}
if ($windowName) {
    $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $children) {
        if ($w.Current.Name -and $w.Current.Name.ToLower().Contains($windowName.ToLower())) { $target = $w; break }
    }
    if (-not $target) { Write-Error "no window matched: $windowName" -ErrorAction Stop }
} else {
    # Walk up from the focused element to the nearest Window ancestor — pure UIA,
    # no P/Invoke required (avoids fragile here-string parsing over stdin pipes).
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if (-not $focused) { Write-Error 'no focused element' -ErrorAction Stop }
    $walkerUp = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $cursor = $focused
    while ($cursor -ne $null -and $cursor.Current.ControlType.ProgrammaticName -notmatch 'Window$') {
        $cursor = $walkerUp.GetParent($cursor)
    }
    if (-not $cursor) { $cursor = $root.GetUpdatedCache([System.Windows.Automation.CacheRequest]::new()) }
    $target = $cursor
    if (-not $target) { Write-Error 'could not resolve foreground window' -ErrorAction Stop }
}

$mode = '${mode}'
$maxNodes = ${maxNodes}
$maxDepth = ${maxDepth}
$includeOff = $${includeOffscreen ? 'true' : 'false'}
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

$interactiveTypes = @('Button','Edit','Hyperlink','ListItem','MenuItem','CheckBox','RadioButton','Tab','TabItem','ComboBox','SplitButton','TreeItem')
$nodes = New-Object System.Collections.ArrayList
$script:visited = 0

function To-Node($el, $depth) {
    try {
        $b = $el.Current.BoundingRectangle
        $ct = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\\.',''
        return [pscustomobject]@{
            name = $el.Current.Name
            controlType = $ct
            automationId = $el.Current.AutomationId
            className = $el.Current.ClassName
            depth = $depth
            x = [int]$b.X; y = [int]$b.Y
            width = [int]$b.Width; height = [int]$b.Height
            enabled = $el.Current.IsEnabled
            offscreen = $el.Current.IsOffscreen
        }
    } catch { return $null }
}

function Walk-Tree($el, $depth) {
    if ($script:visited -ge $maxNodes) { return $null }
    if ($depth -gt $maxDepth) { return $null }
    $n = To-Node $el $depth
    if (-not $n) { return $null }
    if (-not $includeOff -and $n.offscreen) { return $null }
    $script:visited++
    $children = @()
    $child = $walker.GetFirstChild($el)
    while ($child -ne $null -and $script:visited -lt $maxNodes) {
        $c = Walk-Tree $child ($depth + 1)
        if ($c) { $children += $c }
        $child = $walker.GetNextSibling($child)
    }
    Add-Member -InputObject $n -NotePropertyName children -NotePropertyValue $children -Force
    return $n
}

function Walk-Flat($el, $depth) {
    if ($script:visited -ge $maxNodes) { return }
    if ($depth -gt $maxDepth) { return }
    $n = To-Node $el $depth
    if (-not $n) { return }
    if (-not $includeOff -and $n.offscreen) { return }
    $script:visited++
    if ($mode -eq 'flat') {
        [void]$nodes.Add($n)
    } elseif ($interactiveTypes -contains $n.controlType) {
        [void]$nodes.Add($n)
    }
    $child = $walker.GetFirstChild($el)
    while ($child -ne $null -and $script:visited -lt $maxNodes) {
        Walk-Flat $child ($depth + 1)
        $child = $walker.GetNextSibling($child)
    }
}

if ($mode -eq 'tree') {
    $treeRoot = Walk-Tree $target 0
    $payload = [pscustomobject]@{
        window = $target.Current.Name
        mode = $mode
        count = $script:visited
        truncated = ($script:visited -ge $maxNodes)
        tree = $treeRoot
    }
} else {
    Walk-Flat $target 0
    $payload = [pscustomobject]@{
        window = $target.Current.Name
        mode = $mode
        count = $nodes.Count
        visited = $script:visited
        truncated = ($script:visited -ge $maxNodes)
        nodes = $nodes
    }
}
$payload | ConvertTo-Json -Depth 20 -Compress
        `.trim();
        return await runPsJsonFile(script, { timeoutMs: 25_000 });
    },
};

module.exports = { uiaFind, uiaInvoke, uiaGetText, uiaSnapshot };