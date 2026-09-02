import type { AttributeKey, Fighter } from './types';
import { STAT_CAPS } from './constants';
import { recomputeDerived } from './stats';
import { getSkill, STYLE_TREES } from './skills';

/** Spends one attribute point. Returns a new fighter; throws if none remain or at cap. */
export function spendAttributePoint(fighter: Fighter, attr: AttributeKey): Fighter {
  if (fighter.attributePoints <= 0) throw new Error('No attribute points remaining');
  if (fighter.attributes[attr] >= STAT_CAPS[attr]) throw new Error(`${attr} is already at its cap`);
  const next: Fighter = {
    ...fighter,
    attributes: { ...fighter.attributes, [attr]: fighter.attributes[attr] + 1 },
    attributePoints: fighter.attributePoints - 1,
  };
  return recomputeDerived(next);
}

/** Spends one skill point in the fighter's style tree. Returns a new fighter. */
export function spendSkillPoint(fighter: Fighter, skillId: string): Fighter {
  if (fighter.skillPoints <= 0) throw new Error('No skill points remaining');
  const node = getSkill(skillId);
  if (!node) throw new Error('Unknown skill');
  const current = fighter.skills[skillId] ?? 0;
  if (current >= node.maxRank) throw new Error('Skill is already maxed');
  if (!STYLE_TREES[fighter.style].includes(skillId)) throw new Error('Not in this style tree');
  const next: Fighter = {
    ...fighter,
    skills: { ...fighter.skills, [skillId]: current + 1 },
    skillPoints: fighter.skillPoints - 1,
  };
  return recomputeDerived(next);
}
