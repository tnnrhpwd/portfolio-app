# Coliseum — Blender Authoring Spec (build the `.blend`)

Companion to `Coliseum-Sprite-Pipeline.md`. This is the step-by-step checklist to
author the Blender file that `scripts/blender/render_fighter_layers.py` renders.
Follow it in order; the script and the Phaser integration assume these exact
names and structure.

> **Prototype first.** Build ONE body + ONE sword + ONE helmet, run the render,
> and approve the look before authoring the full 40-body / 9-weapon matrix.

## What you'll produce

- `coliseum-fighters.blend` — one armature, a base human mesh, armor/weapon/shield
  meshes, two orthographic cameras, PBR materials, HDRI lighting.
- Running `blender --background coliseum-fighters.blend --python render_fighter_layers.py`
  emits `sprites/` (240×360 transparent PNG frames + `manifest.json`).

## Software & accounts

- **Blender 4.x LTS** (4.2+) — free, from blender.org.
- **Mixamo** — **mixamo.com** (it's "Mixamo", not "Maximo"!) — free with an
  Adobe account, for the rig + animations. Needs a WebGL-enabled browser
  (Chrome/Edge/Firefox).
- Optional: **MakeHuman** for a custom base mesh (or use Mixamo's built-in
  characters to start).
- **Fallback if mixamo.com won't load:** **AccuRig** (free Windows app from
  Reallusion) for auto-rigging + **ActorCore** for animations, or Blender's
  built-in **Rigify** (free). See the note in Step 1.

### Opening Blender and running the render

On Windows, Blender installs to
`C:\Program Files\Blender Foundation\Blender <version>\blender.exe`. To run the
render script from this repo's root, use the full path:

```powershell
& "C:\Program Files\Blender Foundation\Blender 4.2\blender.exe" --background coliseum-fighters.blend --python scripts/blender/render_fighter_layers.py
```

(If you add Blender's folder to PATH you can type `blender` instead.)

## Blender UI primer (read this first)

Blender looks intimidating; you only need a small slice of it.

**The 3D Viewport** (the big middle area) shows your scene:
- **Orbit:** hold the middle mouse button and drag.
- **Pan:** Shift + middle-mouse drag.
- **Zoom:** scroll wheel.
- **Numpad 1** = front view, **3** = side, **7** = top, **0** = through the camera.
  (No numpad? View menu → Viewpoint → Front/Side/Top/Camera.)
- **G** = move, **R** = rotate, **S** = scale, **X** = delete, **Tab** = toggle Edit Mode.

**Editors** are the panels around the viewport. The ones you'll use:
- **Outliner** (top-right by default): lists objects AND collections. Rename by
  double-clicking a name or pressing **F2**; manage collections here.
- **Properties** (bottom-right): tabbed settings. The tab icons you'll click:
  - **Render** (camera-back icon) — render engine, film/transparency.
  - **Output** (printer icon) — image size + format.
  - **Data** (green camera icon on a camera) — object-specific settings (lens).
  - **Material** (red checkered sphere) — materials.
  - **Object** (orange square) — transforms and collection membership.

**Add a new object:** Shift+A (Object Mode) → choose e.g. Mesh, Camera, Light.

**Move a mesh into a collection:** select it, press **M**, pick the collection.

> If you ever get lost: File → New → General gives a fresh scene. Save often
> (Ctrl+S).

---

## Step 1 — Get a base mesh (Mixamo)

You need one humanoid in a neutral **T-pose/A-pose**, no animation.

1. Go to **https://www.mixamo.com** (it's "Mixamo", not "Maximo") and sign in
   with a free Adobe account. Use a WebGL-enabled browser (Chrome, Edge, or
   Firefox).
2. Click **Characters** and pick a human character (avoid robots/creatures).
   "X Bot" works, but a plain human-looking one is closer to a gladiator.
3. Click **Download** and set:
   - Format: **FBX for Unity (.fbx)** (imports fine into Blender)
   - Pose: **T-pose**
   - Skin: **With Skin** (includes the mesh)
4. Click Download → save the `.fbx` somewhere you'll remember (e.g. a
   `coliseum-assets/` folder).

You'll need **two** bodies eventually (male + female); start with one.

> Using MakeHuman instead? Export an FBX from MakeHuman, then upload it to
> Mixamo (Step 2) to auto-rig it.

### If Mixamo won't load (or is down)

Mixamo is free but unmaintained and has occasional outages. If the site won't
load for you, use this free fallback for the same result:

1. **AccuRig** (free Windows app from Reallusion) — drop in your character, it
   auto-rigs it (like Mixamo) and exports FBX.
2. **ActorCore** (Reallusion's site) — browse free/cheap animations and download
   them for your rigged character.
3. Or skip web tools entirely: **Rigify** (built into Blender) auto-rigs a
   character, and free mocap clips (e.g. the CMU library) can be retargeted
   onto it.

Whichever route you take, the Blender-side steps (3 onward) are the same — all
that matters is you end up with a rigged humanoid + five animation clips named
`idle`/`walk`/`attack`/`hit`/`death`.

## Step 2 — Download the five animations (Mixamo)

1. On Mixamo (mixamo.com), click **Animations**. Search/download each clip below,
   one at a time.
2. For each clip, keep the SAME character selected and set:
   - Format: **FBX for Unity (.fbx)**
   - Pose: **In Place** (the character animates on the spot — critical for
     sprite sheets)
   - Skin: **With Skin**
3. Download these five (names aren't mandatory — these are a starting point):

   | Slot | Mixamo clip | Notes |
   | --- | --- | --- |
   | `idle` | "Breathing Idle" | subtle, loops |
   | `walk` | "Walk" (or "Walking") | front/side motion |
   | `attack` | "Sword Slash" | generic weapon swing |
   | `hit` | "Hit Reaction" / "Taking Damage" | short flinch |
   | `death` | "Dying" / "Death" | falls, ends on the ground |

4. Also download the **T-pose (no animation)** version once — set Pose: T-pose.
   This is the rig + body you'll build everything on.

## Step 3 — Import into Blender

### 3.1 Import the T-pose

1. Open Blender — the default scene has a cube, camera, and light. Leave them.
2. **File → Import → FBX (.fbx)** and select your T-pose file.
3. You should now see an **Armature** (the skeleton, drawn as lines) and a body
   **mesh** in the Outliner.

### 3.2 Fix the scale

Mixamo FBX often imports at the wrong size.

1. Click the armature, press **S** and move the mouse to scale; hold **Ctrl** to
   snap. Aim for the character to be roughly **2 grid squares tall** (one grid
   square = 1 m), with the feet on **Z = 0**.
2. Or set it exactly: **Properties → Object** → set Scale X/Y/Z to the same
   value until the character is ~2 units tall.
3. Apply the scale so it sticks: select the armature (and mesh), press
   **Ctrl+A → Scale**.

### 3.3 Import the animations

1. **File → Import → FBX** for each of the five animation files, one at a time.
2. Each import adds a NEW armature + mesh (clones). Don't panic — the important
   thing each import adds is an **Action** (the animation data).

### 3.4 Rename the actions

Actions are stored globally, separate from the clones.

1. In the **Outliner**, change its display mode: the dropdown at the top of the
   Outliner currently says **"View Layer"** → switch it to **"Blender File"**.
2. Expand **Actions**. You'll see entries named after the Mixamo clips.
3. Rename each with **F2** (or right-click → Rename) to exactly:
   `idle`, `walk`, `attack`, `hit`, `death`.

### 3.5 Delete the animation clones

The imported animation FBXs brought duplicate armatures + meshes you don't need.

1. Switch the Outliner back to **"View Layer"** mode.
2. Select the duplicate armatures and meshes (NOT your original T-pose armature
   + body) and press **X → Delete**.
3. The renamed Actions stay in the file even after deleting the clones.

### 3.6 Check each animation

1. Select your original armature.
2. Change any editor to the **Action Editor** (use the editor-type dropdown in a
   panel's top-left corner, pick "Action Editor").
3. In its header, click the action dropdown and pick `idle`, then press **Space**
   to play. Repeat for `walk` / `attack` / `hit` / `death`.
4. Watch for: feet sliding, the character flying away, or bones bending wrong.
   If a clip looks broken, re-download it from Mixamo in **In Place** mode.

> You don't need to leave an action assigned — the render script assigns each
> action itself when it renders. This step is just to verify the animations.

## Step 4 — Scene, transparency, and cameras

### 4.1 Transparent background

1. **Properties → Render** (camera-back icon).
2. Under **Film**, tick **Transparent**. (Rendered images show a checkerboard =
   transparent.)

### 4.2 Output size + format

1. **Properties → Output** (printer icon).
2. Set **Resolution X = 240**, **Y = 360**.
3. File Format: **PNG**, Color: **RGBA**.

(The render script also sets these — this is for a manual test render.)

### 4.3 Two orthographic cameras

1. Add a camera: **Shift+A → Camera**. Rename it `CamFront` (Outliner → F2).
2. Aim it at the front: press **Numpad 1** (front view), select the camera, then
   **Ctrl+Alt+Numpad 0** ("Camera to View"). Press **Numpad 0** to check.
3. Make it orthographic: select the camera → **Properties → Data** (green camera
   icon) → **Lens → Type: Orthographic**. Set **Orthographic Scale** so the
   character (head to feet) fills the view with a little margin.
4. Duplicate for the side view: select `CamFront`, **Shift+D**, press **R → Z →
   90 → Enter**, rename it `CamSide`.
5. Aim it at the side: press **Numpad 3** (side view), select `CamSide`, then
   **Ctrl+Alt+Numpad 0**.
6. **Use the same Orthographic Scale on both** so front and side render the same
   height. Nudge the scale on both until the character fits the same way.

### 4.4 Render engine

- **Properties → Render → Render Engine**: choose **Cycles** (quality) or
  **EEVEE Next** (speed). The script sets this too; Cycles + denoise is the
  safe default.

## Step 5 — PBR materials + lighting

### 5.1 HDRI lighting (makes PBR look right)

1. Download a free HDRI from **polyhaven.com** (any neutral studio/outdoor one).
2. Open a **Shader Editor** panel (switch an editor's type to "Shader Editor").
3. In its header, change the dropdown that says **Object** to **World**.
4. **Shift+A → Texture → Environment Texture**, load your `.hdr` file, and
   connect: `Environment Texture (Color)` → `Background (Color)` →
   `World Output (Surface)`.
5. In the 3D viewport, switch the shading mode (top-right corner icons) to
   **Rendered** (4th icon) or **Material Preview** (3rd icon) to see lighting.

### 5.2 Body material (skin)

1. Select the body mesh → **Properties → Material** (red sphere) → **New**.
2. Surface is **Principled BSDF** by default. Set **Base Color** to a skin tone
   and **Roughness ≈ 0.6**.

### 5.3 Metal materials (armor/weapons/shields)

1. Select a metal mesh → Material tab → **New**.
2. **Metallic = 1.0**, **Roughness** 0.35–0.6, and **Base Color** by tier:
   - bronze `#8a5a2b`, iron/steel `#9aa4ad`, gold `#e8b84b`
   (these match the current SVG tier colors).

> For 240px sprites, a clean base color + HDRI is usually enough — skip
> Normal/Roughness maps until the prototype looks wrong.

## Step 6 — Collections (exact names)

The render script shows/hides things by **collection name**. Get these exactly
right or the script renders nothing.

### 6.1 Create the master collection

1. In the **Outliner**, right-click in empty space → **New Collection**. Name it
   `Render` (F2).

### 6.2 Create one sub-collection per layer

Right-click on `Render` → **New Collection** for each name below. Start with the
prototype minimum, then add the rest:

| Collection | Contains | Render pass |
| --- | --- | --- |
| `Body.male-light-short` | body mesh (one variant) | body |
| `Armor.head-0` | helmet (bronze) | armor overlay |
| `Weapon.gladius` | sword | weapon overlay |
| `Offhand.gladius` | off-hand sword (optional) | off-hand overlay |
| `Shield.round` | round shield | shield overlay |

**Full name lists** (author incrementally, after the prototype):

- Armor: `{head,torso,leftArm,rightArm,legs}` × `{0,1,2}` (bronze/iron/gold).
- Weapons: `{gladius,axe,mace,spear,dagger,trident,greatsword,maul,halberd}`.
- Off-hand: same weapon list.
- Shields: `{buckler,round,tower,net}`.
- Bodies: `{male,female}-{light,tan,brown,dark}-{short,long,tied,curly,bald}`
  (40 total — author them incrementally, not all at once).
- Icons (single frame, no animation): `ArmorIcon.*`, `WeaponIcon.*`, `ShieldIcon.*`.

### 6.3 Put each mesh in its collection

1. Select the mesh in the viewport or Outliner.
2. Press **M → choose the collection** (or **New** and name it).
3. Verify in the Outliner: the mesh appears nested under the right collection.

### Critical structural rules

1. **The armature must NOT be inside `Render`.** Keep it at scene top level so
   it keeps animating while the script hides every mesh collection.
2. **Parenting decides how a piece follows the character:**
   - **Deforming pieces** (torso/arm/leg armor): select the armor mesh, Shift-click
     the armature, **Ctrl+P → With Automatic Weights** (it flexes with the body).
   - **Rigid attachments** (helmet, weapon, shield): select the mesh, Shift-click
     the armature, switch to **Pose Mode** (top-left dropdown), select the target
     bone (head / right hand / left hand), then **Ctrl+P → Bone**.
3. **Collection membership and parenting are separate.** A mesh can be parented
   to the armature (for movement) AND belong to a `Render` sub-collection (for
   visibility). Do both.
4. **Same origin/scale for everything:** every piece must be modeled/positioned
   against the SAME armature at the SAME world origin, or layers won't align
   when stacked in the game.

## Step 7 — Render the prototype

### 7.1 Manual test first

1. Select `CamFront`, press **Numpad 0**, then **F12** to render one frame.
   Check: the character is centered, background is the transparent checkerboard,
   and it fits the 240×360 frame.
2. Do the same for `CamSide`.

### 7.2 Run the script

From the repo root, in PowerShell:

```powershell
& "C:\Program Files\Blender Foundation\Blender 4.2\blender.exe" --background coliseum-fighters.blend --python scripts/blender/render_fighter_layers.py
```

- Replace the Blender path with your installed version.
- Set `$env:COLISEUM_OUT = "..."` first to override the output folder.
- Output lands in `sprites/` next to the `.blend` (or in `COLISEUM_OUT`), plus
  `manifest.json` listing every rendered frame.

> If you get `Missing collection: ...` — a collection name in the `.blend` does
> not match the script. Check Step 6 names character-for-character.

## Step 8 — Review checklist (prototype gate)

Render ONE body + ONE weapon + ONE helmet, then confirm every box:

- [ ] Frames are transparent (no grey/black background).
- [ ] `CamFront` and `CamSide` produce the same character height.
- [ ] Armor aligns on the body when stacked (no floating helmet / offset chest).
- [ ] Weapons follow the hand through the attack arc (no detach in any frame).
- [ ] All five animations play at the expected frame counts.
- [ ] No bone-name/foot-slide errors from the Mixamo import.

Approve this, then author the remaining bodies, armor tiers, and weapon/shield
kinds — and the Phaser `sprites.ts` integration can start against the locked
frame/name contract.
