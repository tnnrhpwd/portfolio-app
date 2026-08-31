/**
 * goalAgentApi.js — Frontend API helpers for the Goal Agent.
 *
 *   POST /api/data/goal-agent/start          → startGoalAgent
 *   GET  /api/data/goal-agent/status/:goalId → getGoalAgentStatus
 *   POST /api/data/goal-agent/stop           → stopGoalAgent
 */

import { getApiBase } from '../config/api';

function headers(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Enlist the Goal Agent to autonomously fix an open bug report from the
 * admin panel. The backend creates a fix goal owned by the admin and starts
 * the agent; the returned `goalId` can be polled with getGoalAgentStatus().
 */
export async function enlistAgentForBug(token, bugId, instruction = '') {
  const res = await fetch(`${getApiBase()}admin/agent-fix`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ bugId, ...(instruction ? { instruction } : {}) }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || json.dataMessage || 'Failed to enlist agent');
  return json;
}

/** Start an LLM agent run on a goal. */
export async function startGoalAgent(token, goalId) {
  const res = await fetch(`${getApiBase()}goal-agent/start`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ goalId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to start agent');
  return json;
}

/** Fetch the current agent run status for a goal. */
export async function getGoalAgentStatus(token, goalId) {
  const res = await fetch(`${getApiBase()}goal-agent/status/${goalId}`, {
    headers: headers(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to fetch agent status');
  return json;
}

/** Stop a running agent for a goal. */
export async function stopGoalAgent(token, goalId) {
  const res = await fetch(`${getApiBase()}goal-agent/stop`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ goalId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to stop agent');
  return json;
}
