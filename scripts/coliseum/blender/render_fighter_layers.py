"""
render_fighter_layers.py — render the Coliseum paperdoll sprite passes from Blender.

Run (no GUI):
    blender --background fighters.blend --python render_fighter_layers.py

Renders each layer of the layered fighter system to transparent PNG frames, for
two views and five animations. Layer naming mirrors the game's Phaser texture
keys so the output drops straight into `textures.ts` / the future `sprites.ts`.

Full spec: docs/guides/Coliseum-Sprite-Pipeline.md

Output layout (under OUT_DIR):
    human/<variantId>/<view>/<anim>/f_0000.png ...
    armor/<slot>-<tier>/<view>/<anim>/f_0000.png ...
    weapon/<kind>/<view>/<anim>/f_0000.png ...
    offhand-weapon/<kind>/<view>/<anim>/f_0000.png ...
    shield/<kind>/<view>/<anim>/f_0000.png ...
    armor-icon/<slot>-<tier>/f_0000.png
    weapon-icon/<kind>/f_0000.png
    shield-icon/<kind>/f_0000.png
    manifest.json

The .blend must be authored to match the naming conventions below.
"""
import bpy
import json
import os

C = bpy.context
S = C.scene

# ── Config ────────────────────────────────────────────────────────────────────
# Mirrors the lists in frontend/src/pages/Projects/Coliseum/game/assets/art.ts.
OUT_DIR = os.environ.get("COLISEUM_OUT") or os.path.join(
    os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd(),
    "sprites",
)

VIEWS = ["front", "side"]
ANIMS = ["idle", "walk", "attack", "hit", "death"]

# Fallback frame ranges when an Action with the same name isn't present in the
# .blend. If the .blend has Actions named `idle`, `walk`, ... their frame range
# is used instead (see action_range()).
ANIM_FRAMES = {
    "idle": (1, 12),
    "walk": (1, 12),
    "attack": (1, 14),
    "hit": (1, 6),
    "death": (1, 12),
}

# Base body catalog (finite, pre-rendered). 2 genders × 4 skin tones × 5
# hairstyles = 40 bodies. Add/remove entries to match the authored collections.
SKIN_TONES = ["light", "tan", "brown", "dark"]
HAIR_STYLES = ["short", "long", "tied", "curly", "bald"]
GENDERS = ["male", "female"]

ARMOR_SLOTS = ["head", "torso", "leftArm", "rightArm", "legs"]
ARMOR_TIERS = [0, 1, 2]  # 0 bronze, 1 iron/steel, 2 gold (armorGroup() in textures.ts)
WEAPON_KINDS = ["gladius", "axe", "mace", "spear", "dagger", "trident", "greatsword", "maul", "halberd"]
SHIELD_KINDS = ["buckler", "round", "tower", "net"]

# Camera names per view. Falls back to the scene camera if a name is missing.
CAMERAS = {"front": "CamFront", "side": "CamSide"}

# Render resolution (2:3, 2× the in-game 120×180 display size).
RENDER_W = 240
RENDER_H = 360

# Cycles (quality) vs EEVEE (speed). Both are PBR-capable.
RENDER_ENGINE = "CYCLES"
CYCLES_SAMPLES = 64
EEVEE_SAMPLES = 32

# Master collection that contains every renderable sub-collection. Every layer
# toggled below must live under this collection.
MASTER_COLLECTION = "Render"


# ── Helpers ──────────────────────────────────────────────────────────────────

def collection(name):
    coll = bpy.data.collections.get(name)
    if coll is None:
        raise KeyError(f"Missing collection: {name}")
    return coll


def set_engine(engine):
    S.render.engine = engine
    if engine == "CYCLES":
        S.cycles.samples = CYCLES_SAMPLES
        S.cycles.use_denoising = True
    else:
        S.eevee.taa_render_samples = EEVEE_SAMPLES


def set_camera(view):
    cam_name = CAMERAS.get(view)
    cam = bpy.data.objects.get(cam_name) if cam_name else None
    if cam is not None and cam.type == "CAMERA":
        S.camera = cam
    # else: leave the scene camera as-is.


def action_range(anim):
    """Frame range for an Action named `anim`, else the ANIM_FRAMES fallback."""
    action = bpy.data.actions.get(anim)
    if action is not None:
        lo = int(action.frame_range[0])
        hi = int(action.frame_range[1])
        if hi > lo:
            return (lo, hi)
    return ANIM_FRAMES.get(anim, (1, 12))


def activate_action(anim):
    """Assign Action `anim` to the first armature so it drives all meshes."""
    action = bpy.data.actions.get(anim)
    if action is None:
        return  # no action; static pose per current frame
    armature = next((o for o in S.objects if o.type == "ARMATURE"), None)
    if armature is None:
        return
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action


def show_only(target):
    """Hide every child of MASTER_COLLECTION except `target`."""
    master = collection(MASTER_COLLECTION)
    for child in master.children:
        child.hide_render = child is not target
    master.hide_render = False


def body_variant_id(gender, skin, hair):
    return f"{gender}-{skin}-{hair}"


def render_pass(rel_dir, view, anim, target):
    """Render every frame of `anim` with only `target` visible."""
    lo, hi = action_range(anim)
    activate_action(anim)
    set_camera(view)
    show_only(target)
    out = os.path.join(OUT_DIR, rel_dir, view, anim)
    os.makedirs(out, exist_ok=True)
    frames = []
    for f in range(lo, hi + 1):
        S.frame_set(f)
        file_path = os.path.join(out, f"f_{f - lo:04d}.png")
        S.render.filepath = file_path
        bpy.ops.render.render(write_still=True)
        frames.append(os.path.relpath(file_path, OUT_DIR))
    return frames


def render_icon(rel_dir, target):
    """Render a single orthographic frame for an icon."""
    set_camera("front")
    show_only(target)
    out = os.path.join(OUT_DIR, rel_dir)
    os.makedirs(out, exist_ok=True)
    file_path = os.path.join(out, "f_0000.png")
    S.frame_set(1)
    S.render.filepath = file_path
    bpy.ops.render.render(write_still=True)
    return os.path.relpath(file_path, OUT_DIR)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    S.render.resolution_x = RENDER_W
    S.render.resolution_y = RENDER_H
    S.render.film_transparent = True
    S.render.image_settings.file_format = "PNG"
    S.render.image_settings.color_mode = "RGBA"
    set_engine(RENDER_ENGINE)

    manifest = {"engine": RENDER_ENGINE, "size": [RENDER_W, RENDER_H], "layers": {}}

    # Body variants.
    for gender in GENDERS:
        for skin in SKIN_TONES:
            for hair in HAIR_STYLES:
                vid = body_variant_id(gender, skin, hair)
                coll_name = f"Body.{vid}"
                if not bpy.data.collections.get(coll_name):
                    continue  # author may not have created every combination
                frames = {}
                for view in VIEWS:
                    for anim in ANIMS:
                        frames[f"{view}/{anim}"] = render_pass(
                            "human", view, anim, collection(coll_name)
                        )
                manifest["layers"][f"human/{vid}"] = frames

    # Armor overlays + icons.
    for slot in ARMOR_SLOTS:
        for tier in ARMOR_TIERS:
            key = f"{slot}-{tier}"
            if bpy.data.collections.get(f"Armor.{key}"):
                frames = {}
                for view in VIEWS:
                    for anim in ANIMS:
                        frames[f"{view}/{anim}"] = render_pass(
                            "armor", view, anim, collection(f"Armor.{key}")
                        )
                manifest["layers"][f"armor/{key}"] = frames
            if bpy.data.collections.get(f"ArmorIcon.{key}"):
                manifest["layers"][f"armor-icon/{key}"] = render_icon(
                    "armor-icon", collection(f"ArmorIcon.{key}")
                )

    # Weapons: main-hand overlay, off-hand overlay, icon.
    for kind in WEAPON_KINDS:
        if bpy.data.collections.get(f"Weapon.{kind}"):
            frames = {}
            for view in VIEWS:
                for anim in ANIMS:
                    frames[f"{view}/{anim}"] = render_pass(
                        "weapon", view, anim, collection(f"Weapon.{kind}")
                    )
            manifest["layers"][f"weapon/{kind}"] = frames
        if bpy.data.collections.get(f"Offhand.{kind}"):
            frames = {}
            for view in VIEWS:
                for anim in ANIMS:
                    frames[f"{view}/{anim}"] = render_pass(
                        "offhand-weapon", view, anim, collection(f"Offhand.{kind}")
                    )
            manifest["layers"][f"offhand-weapon/{kind}"] = frames
        if bpy.data.collections.get(f"WeaponIcon.{kind}"):
            manifest["layers"][f"weapon-icon/{kind}"] = render_icon(
                "weapon-icon", collection(f"WeaponIcon.{kind}")
            )

    # Shields: overlay + icon.
    for kind in SHIELD_KINDS:
        if bpy.data.collections.get(f"Shield.{kind}"):
            frames = {}
            for view in VIEWS:
                for anim in ANIMS:
                    frames[f"{view}/{anim}"] = render_pass(
                        "shield", view, anim, collection(f"Shield.{kind}")
                    )
            manifest["layers"][f"shield/{kind}"] = frames
        if bpy.data.collections.get(f"ShieldIcon.{kind}"):
            manifest["layers"][f"shield-icon/{kind}"] = render_icon(
                "shield-icon", collection(f"ShieldIcon.{kind}")
            )

    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    print(f"Done. Rendered {len(manifest['layers'])} layers to {OUT_DIR}")


if __name__ == "__main__":
    main()
