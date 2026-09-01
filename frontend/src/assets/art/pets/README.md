# Pet artwork

Drop AI-generated images in this folder and the Pets page (`/pets`) picks them up
automatically — no code changes needed.

## File naming

| Purpose | Filename | Example |
| --- | --- | --- |
| Room background | `room.<ext>` | `room.png` |
| A pet species | `pet-<species>.<ext>` | `pet-dog.png` |

Supported extensions: `.jpg`, `.jpeg`, `.png`, `.webp`.
Species keys (from the backend catalog): `dog`, `cat`, `bunny`, `hamster`,
`parrot`, `axolotl`, `fox`, `panda`, `penguin`, `hedgehog`, `turtle`, `koala`.

## Recommended format

- **Pets:** full-body character, **transparent background PNG** (or plain white
  background), centered, facing slightly toward camera, 1024×1024 or larger.
- **Room:** wide 16:9 interior with an empty foreground floor for pets to stand on.

If an image is missing, the page gracefully falls back to the species emoji, and
the room falls back to the animated gradient.
