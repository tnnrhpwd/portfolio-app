// services/deepStorageService.js
//
// Generates the "Deep Storage" catalog: every stackable Minecraft Bedrock
// Edition item obtainable in normal survival gameplay.
//
// The list of *which* items belong in the catalog is no longer derived by
// filtering the Microsoft Docs item table — that table is incomplete and
// includes non-survival/non-stackable/legacy-alias rows that required an
// ever-growing set of exclusion rules to work around. Instead, the catalog
// membership is defined by a hand-curated, manually-verified master list
// (`data/deepstorage-master-items.csv`) that is the single source of truth
// for exactly which items should appear, and under what display name/id.
//
// This service still fetches the Microsoft Docs source table, but only to
// look up each master item's real Bedrock numeric id (for informational
// display) — it no longer decides which items are included. On regenerate:
//   1. Load the master CSV (name + item id for every catalog item).
//   2. Fetch + parse the Microsoft Docs item table for numeric id lookups.
//   3. For each master item, resolve its numeric id (or null if the item
//      has no distinct numeric id, e.g. tipped arrows / dyed variants that
//      share a base item + NBT data).
//   4. Persist the resulting list to DynamoDB so it only needs to be
//      regenerated when an admin explicitly requests it (see
//      deepStorageController.js).

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { logger } = require('../utils/logger');

const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'Simple';
const STORAGE_RECORD_ID = 'deepstorage-items-v1';
// The `Simple` table uses a composite key (id + createdAt as sort key).
// We pin the sort key to a fixed value so every regeneration overwrites the
// same single record instead of appending a new one; the real generation
// timestamp is tracked separately inside the stored payload (`generatedAt`)
// and in the item's `updatedAt` attribute.
const STORAGE_SORT_KEY = 'deepstorage-record';
const SOURCE_URL = 'https://raw.githubusercontent.com/MicrosoftDocs/minecraft-creator/main/creator/Reference/Content/VanillaListingsReference/Items.md';
const MASTER_CSV_PATH = path.join(__dirname, '..', 'data', 'deepstorage-master-items.csv');

// ════════════════════════════════════════════════════════════════
// Alias data — used only to resolve numeric ids from the Microsoft Docs
// source table onto the canonical item ids used in the master CSV (the
// source table sometimes uses legacy/internal names for the same item).
// ════════════════════════════════════════════════════════════════
const ALIAS_MAP = {
    frame: 'item_frame',
    glow_frame: 'glow_item_frame',
    normal_stone_slab: 'stone_slab',
    wooden_button: 'oak_button',
    wooden_door: 'oak_door',
    wooden_pressure_plate: 'oak_pressure_plate',
    trapdoor: 'oak_trapdoor',
    fence_gate: 'oak_fence_gate',
    dirt_with_roots: 'rooted_dirt',
    magma: 'magma_block',
    lit_pumpkin: 'jack_o_lantern',
    silver_glazed_terracotta: 'light_gray_glazed_terracotta',
    // Legacy/internal ids renamed to their modern, expected item ids. Each of
    // these target names is confirmed absent as its own row in the source
    // table (verified against the live Items.md), so no collision risk.
    stone_stairs: 'cobblestone_stairs', // id 67 — the only "stairs" row for cobblestone
    noteblock: 'note_block',
    hardened_clay: 'terracotta', // uncolored terracotta; colored variants already have their own rows
    end_bricks: 'end_stone_bricks',
    end_brick_stairs: 'end_stone_brick_stairs',
    prismarine_bricks_stairs: 'prismarine_brick_stairs',
    deadbush: 'dead_bush',
    brick_block: 'bricks',
    golden_rail: 'powered_rail',
    slime: 'slime_block',
    small_dripleaf_block: 'small_dripleaf',
    waterlily: 'lily_pad',
    waxed_copper: 'waxed_copper_block',
    web: 'cobweb',
    nether_brick: 'nether_bricks',
    red_nether_brick: 'red_nether_bricks',
    quartz_ore: 'nether_quartz_ore',
    turtle_scute: 'scute',
    snow: 'snow_block',
    iron_chain: 'chain',
    azalea_leaves_flowered: 'flowering_azalea_leaves',
};

// ════════════════════════════════════════════════════════════════
// Master item list (data/deepstorage-master-items.csv)
//
// This CSV is the single source of truth for catalog membership: it was
// hand-verified against real Bedrock Edition survival gameplay. Every row
// becomes exactly one catalog item; no items are added or excluded beyond
// what's in this file.
//
// A handful of rows in the CSV have a blank `itemid` column — either
// because they're tipped-arrow potion variants (which don't have their own
// Bedrock item id; they share the base "arrow" id + NBT data) or because
// their real internal Bedrock id differs from a naive slug of the display
// name. ID_OVERRIDES supplies the correct id for those cases; anything not
// listed here falls back to a naive slug of the display name.
// ════════════════════════════════════════════════════════════════
const ID_OVERRIDES = {
    'Empty Locator Map': 'locator_map',
    'Frogspawn': 'frog_spawn',
    'Hay Bale': 'hay_block',
    'Nether Brick': 'netherbrick', // singular crafting item — distinct from the "Nether Bricks" block
    'Nether Quartz': 'quartz',
    'Raw Beef': 'beef',
    'Raw Chicken': 'chicken',
    'Raw Cod': 'cod',
    'Raw Mutton': 'mutton',
    'Raw Porkchop': 'porkchop',
    'Raw Rabbit': 'rabbit',
    'Raw Salmon': 'salmon',
    'Redstone Comparator': 'comparator',
    'Redstone Dust': 'redstone',
    'Redstone Repeater': 'repeater',
};

// Normalizes an already-populated `itemid` cell that doesn't follow the
// standard lowercase_snake_case convention used everywhere else in the CSV
// (inconsistent capitalization, stray spaces, or an outright wrong id).
const ITEMID_NORMALIZATION_OVERRIDES = {
    dirt_path: 'grass_path', // "Dirt Path" — real Bedrock internal id is grass_path
};

function slugify(displayName) {
    return displayName
        .toLowerCase()
        .replace(/[()]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeItemId(rawId) {
    const normalized = rawId.trim().toLowerCase().replace(/\s+/g, '_');
    return ITEMID_NORMALIZATION_OVERRIDES[normalized] || normalized;
}

/** Minimal CSV parser sufficient for the simple, unquoted master list. */
function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.slice(1).map((line) => {
        const [rawName, rawId] = line.split(',');
        return { displayName: (rawName || '').trim(), rawId: (rawId || '').trim() };
    });
}

/** Load the master item list from disk and resolve every row's item id. */
function loadMasterItems() {
    const csvText = fs.readFileSync(MASTER_CSV_PATH, 'utf8');
    const rows = parseCsv(csvText);

    const seen = new Set();
    const items = [];
    for (const { displayName, rawId } of rows) {
        if (!displayName && !rawId) continue; // stray blank line

        const name = rawId
            ? normalizeItemId(rawId)
            : (ID_OVERRIDES[displayName] || slugify(displayName));

        if (seen.has(name)) {
            logger.warn('Duplicate DeepStorage master item id, skipping', { name, displayName });
            continue;
        }
        seen.add(name);
        items.push({ name, displayName: displayName || toDisplayName(name) });
    }

    return items;
}

// ════════════════════════════════════════════════════════════════
// Supplemental metadata not present in the master CSV.
// Best-effort, based on well-documented Bedrock Edition stack sizes —
// everything else defaults to a stack size of 64.
// ════════════════════════════════════════════════════════════════
const STACK_SIZE_16_EXACT = new Set([
    'egg', 'snowball', 'ender_pearl', 'honey_bottle', 'banner', 'bundle',
]);
const isStackSize16 = (name) => STACK_SIZE_16_EXACT.has(name) || /_sign$/.test(name) || /^sign$/.test(name);

// Lightweight, high-confidence categorisation used for the "Category" filter
// in the UI. Anything that doesn't match a rule falls into "Miscellaneous".
const CATEGORY_RULES = [
    { category: 'Ores & Minerals', test: /^raw_|_ore$|_ingot$|_nugget$|^coal$|^diamond$|^emerald$|^amethyst_shard$|^quartz$|^glowstone_dust$|^redstone$|^lapis_lazuli$/ },
    { category: 'Food & Farming', test: /^(apple|bread|potato|baked_potato|carrot|golden_carrot|beetroot|melon_slice|pumpkin_pie|cookie|cake|sugar|wheat|beef|cooked_beef|porkchop|cooked_porkchop|chicken|cooked_chicken|mutton|cooked_mutton|rabbit|cooked_rabbit|cod|cooked_cod|salmon|cooked_salmon|kelp|dried_kelp|sweet_berries|glow_berries|chorus_fruit|honey_bottle|honeycomb|egg|nether_wart|beetroot_seeds|wheat_seeds|melon_seeds|pumpkin_seeds|pitcher_pod|torchflower_seeds)$|_seeds$|_stew$/ },
    { category: 'Redstone & Mechanisms', test: /^(redstone|redstone_torch|redstone_block|repeater|comparator|lever|tripwire_hook|target|observer|piston|sticky_piston|dropper|dispenser|hopper|rail|activator_rail|detector_rail|powered_rail|daylight_detector)$/ },
    { category: 'Dyes & Colors', test: /_dye$|^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_dye$/ },
    { category: 'Décor & Signage', test: /_sign$|^sign$|^banner$|^\w+_banner$|_carpet$|_glass$|_glass_pane$|_candle$|^flower_pot$|_pottery_sherd$|^armor_stand$/ },
    { category: 'Building — Wood', test: /^(acacia|bamboo|birch|cherry|crimson|dark_oak|jungle|mangrove|oak|pale_oak|poplar|spruce|warped)_(planks|log|wood|slab|stairs|fence|fence_gate|door|trapdoor|button|pressure_plate|leaves|sapling)$/ },
    { category: 'Building — Stone', test: /(stone|cobblestone|deepslate|andesite|diorite|granite|blackstone|basalt|tuff|calcite|dripstone|sandstone|brick|prismarine|purpur|end_stone|nether_brick|quartz_block)(_slab|_stairs|_wall)?$/ },
    { category: 'Nature & Plants', test: /^(dirt|grass_block|podzol|mycelium|sand|gravel|clay|moss_block|moss_carpet|vine|lily_pad|seagrass|coral|bamboo|cactus|sugar_cane|azalea|flowering_azalea)$|_leaves$|_sapling$|_flower$/ },
    { category: 'Mob Drops & Misc', test: /^(feather|leather|string|bone|bone_meal|gunpowder|ink_sac|glow_ink_sac|slime_ball|blaze_powder|blaze_rod|ghast_tear|magma_cream|phantom_membrane|nautilus_shell|scute|rabbit_hide|rabbit_foot|spider_eye|fermented_spider_eye|ender_pearl|ender_eye|nether_star|shulker_shell|armadillo_scute)$/ },
    { category: 'Potions & Tipped Arrows', test: /^arrow_of_|^ominous_bottle/ },
];

function categorize(name) {
    for (const rule of CATEGORY_RULES) {
        if (rule.test.test(name)) return rule.category;
    }
    return 'Miscellaneous';
}

function toDisplayName(name) {
    return name
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

// ════════════════════════════════════════════════════════════════
// Core pipeline
// ════════════════════════════════════════════════════════════════

/** Fetch the raw markdown item table from the Microsoft Docs source. */
async function fetchItemsMarkdown() {
    const response = await axios.get(SOURCE_URL, {
        timeout: 20000,
        headers: { 'User-Agent': 'sthopwood-deepstorage-generator' },
    });
    if (typeof response.data !== 'string') {
        throw new Error('Unexpected response type while fetching item source markdown');
    }
    return response.data;
}

/** Parse `| name | id |` markdown table rows into a de-duplicated, ordered list. */
function parseItemsFromMarkdown(markdown) {
    const parsed = [];
    const seen = new Set();

    const lines = markdown.split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('|')) continue;

        const parts = line.replace(/^\||\|$/g, '').split('|').map((p) => p.trim());
        if (parts.length < 2) continue;

        let name = parts[0].replace(/\[([^\]]+)\]\([^)]+\)/, '$1');
        const id = parts[1];

        if (!name) continue;
        if (/^name$/i.test(name)) continue; // header row
        if (/^[:\-]+$/.test(name)) continue; // markdown separator row
        if (!/^-?\d+$/.test(id)) continue; // ID column must be an integer

        name = ALIAS_MAP[name] || name;

        if (!seen.has(name)) {
            seen.add(name);
            parsed.push({ name, id: parseInt(id, 10) });
        }
    }

    return parsed;
}

/** Build the final, UI-ready item records from the master list + source id lookup. */
function buildItemRecords(masterItems, numericIdByName) {
    const records = masterItems.map(({ name, displayName }) => ({
        name,
        displayName,
        numericId: numericIdByName.has(name) ? numericIdByName.get(name) : null,
        maxStackSize: isStackSize16(name) ? 16 : 64,
        category: categorize(name),
    }));

    return records.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Full pipeline: load master list → fetch/parse source (for numeric ids) → build. Does NOT persist. */
async function generateDeepStorageList() {
    const [markdown, masterItems] = await Promise.all([
        fetchItemsMarkdown(),
        Promise.resolve(loadMasterItems()),
    ]);
    const parsed = parseItemsFromMarkdown(markdown);
    const numericIdByName = new Map(parsed.map(({ name, id }) => [name, id]));
    const items = buildItemRecords(masterItems, numericIdByName);

    return {
        items,
        generatedAt: new Date().toISOString(),
        sourceUrl: SOURCE_URL,
        totalParsed: parsed.length,
        totalKept: items.length,
    };
}

// ════════════════════════════════════════════════════════════════
// Persistence (DynamoDB `Simple` table, same generic id/text schema
// used elsewhere in this app)
// ════════════════════════════════════════════════════════════════

async function saveDeepStorageList(payload) {
    const now = new Date().toISOString();
    await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            id: STORAGE_RECORD_ID,
            createdAt: STORAGE_SORT_KEY,
            text: JSON.stringify(payload),
            updatedAt: now,
        },
    }));
    return payload;
}

async function loadDeepStorageList() {
    const result = await dynamodb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: { ':id': STORAGE_RECORD_ID },
        Limit: 1,
    }));

    const item = result.Items && result.Items[0];
    if (!item || !item.text) return null;

    try {
        return JSON.parse(item.text);
    } catch (error) {
        logger.error('Failed to parse stored DeepStorage item list', { error: error.message });
        return null;
    }
}

/** Regenerate the list from source and persist it. */
async function regenerateAndSave() {
    const payload = await generateDeepStorageList();
    await saveDeepStorageList(payload);
    return payload;
}

module.exports = {
    SOURCE_URL,
    MASTER_CSV_PATH,
    fetchItemsMarkdown,
    parseItemsFromMarkdown,
    loadMasterItems,
    buildItemRecords,
    generateDeepStorageList,
    saveDeepStorageList,
    loadDeepStorageList,
    regenerateAndSave,
};
