import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import dataService from "../../features/data/dataService.js";
import AdminPanel from "../../components/Admin/AdminPanel.jsx";
import { useAdminReadout } from "./adminBarContext";
import { HOME_TITLE_RULE_TYPES, homeTitleRuleTypeInfo, formatTimestamp } from "./adminShared";
import { toast } from "react-toastify";

function HomeTitle() {
  const { user } = useSelector((state) => state.data);

  const [homeTitleSettings, setHomeTitleSettings] = useState(null);
  const [homeTitleLoading, setHomeTitleLoading] = useState(false);
  const [homeTitleSaving, setHomeTitleSaving] = useState(false);
  const [homeTitleError, setHomeTitleError] = useState(null);
  const [homeTitleUpdatedAt, setHomeTitleUpdatedAt] = useState(null);

  const fetchHomeTitleSettings = useCallback(async () => {
    if (!user?.token) return;
    setHomeTitleLoading(true);
    setHomeTitleError(null);
    try {
      const res = await dataService.getAdminHomeTitleSettings(user.token);
      setHomeTitleSettings(res.settings || { defaultTitle: "It's simple.", rules: [] });
      setHomeTitleUpdatedAt(res.updatedAt || null);
    } catch (err) {
      setHomeTitleError(err.message || "Failed to load home title settings");
    } finally {
      setHomeTitleLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchHomeTitleSettings(); }, [fetchHomeTitleSettings]);

  // Save the currently-edited Home Title settings to the backend
  const handleSaveHomeTitleSettings = useCallback(async () => {
    if (!user?.token || !homeTitleSettings) return;
    setHomeTitleSaving(true);
    setHomeTitleError(null);
    try {
      const res = await dataService.updateAdminHomeTitleSettings(user.token, homeTitleSettings);
      toast.success("Home title settings saved.");
      setHomeTitleUpdatedAt(res.updatedAt || null);
    } catch (err) {
      const msg = err?.response?.data?.dataMessage || err.message || "Failed to save home title settings";
      setHomeTitleError(msg);
      toast.error(msg);
    } finally {
      setHomeTitleSaving(false);
    }
  }, [user, homeTitleSettings]);

  const addHomeTitleRule = useCallback(() => {
    setHomeTitleSettings((prev) => {
      const rules = prev?.rules || [];
      const newRule = {
        id: `rule_${Date.now()}`,
        enabled: true,
        priority: rules.length,
        type: "nickname",
        match: "",
        title: "",
      };
      return { ...(prev || { defaultTitle: "It's simple." }), rules: [...rules, newRule] };
    });
  }, []);

  const updateHomeTitleRule = useCallback((id, patch) => {
    setHomeTitleSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rules: prev.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      };
    });
  }, []);

  const removeHomeTitleRule = useCallback((id) => {
    setHomeTitleSettings((prev) => {
      if (!prev) return prev;
      return { ...prev, rules: prev.rules.filter((r) => r.id !== id) };
    });
  }, []);

  const ts = formatTimestamp;

  const ruleCount = homeTitleSettings?.rules?.length || 0;
  const enabledRuleCount = (homeTitleSettings?.rules || []).filter((r) => r.enabled !== false).length;
  useAdminReadout(
    homeTitleSettings
      ? [
          { label: 'Rules', value: ruleCount },
          { label: 'Enabled', value: enabledRuleCount, tone: ruleCount > 0 && enabledRuleCount === 0 ? 'warn' : undefined },
        ]
      : null
  );

  return (
    <AdminPanel
      title="Title rules"
      hint="Evaluated in priority order, lowest number first; the first enabled rule that matches the visitor wins. If nothing matches, the default title is used."
      tools={
        <>
          <button className="btn-sm btn-outline" onClick={addHomeTitleRule}>+ Add rule</button>
          <button
            className="btn-sm"
            onClick={handleSaveHomeTitleSettings}
            disabled={homeTitleSaving || homeTitleLoading || !homeTitleSettings}
          >
            {homeTitleSaving ? "Saving…" : "Save changes"}
          </button>
          {homeTitleUpdatedAt && (
            <span className="admin-chip">Saved <strong>{ts(homeTitleUpdatedAt)}</strong></span>
          )}
        </>
      }
    >
      {homeTitleLoading && <div className="admin-loading">Loading home title settings...</div>}
      {homeTitleError && (
        <div className="admin-error">
          <span>{homeTitleError}</span>
          <button className="btn-sm btn-retry" onClick={fetchHomeTitleSettings}>↻ Retry</button>
        </div>
      )}
      {!homeTitleLoading && homeTitleSettings && (
        <>
          {/* Default title */}
          <div className="ht-default">
            <label className="ht-label" htmlFor="home-title-default">Default title</label>
            <input
              id="home-title-default"
              type="text"
              className="admin-search ht-default__input"
              value={homeTitleSettings.defaultTitle}
              onChange={(e) => setHomeTitleSettings((prev) => ({ ...prev, defaultTitle: e.target.value }))}
              placeholder="It's simple."
            />
            <p className="admin-help-text ht-default__hint">Shown when none of the rules below match.</p>
          </div>

          {/* Rule cards */}
          {homeTitleSettings.rules.length === 0 ? (
            <p className="admin-no-data ht-empty">No custom rules yet — add one below, or leave empty to always show the default title.</p>
          ) : (
            <div className="ht-rule-grid">
              {homeTitleSettings.rules.map((rule, idx) => {
                const info = homeTitleRuleTypeInfo(rule.type);
                return (
                  <div className={`ht-rule-card ${rule.enabled === false ? "ht-rule-card--disabled" : ""}`} key={rule.id}>
                    <div className="ht-rule-card__head">
                      <span className="ht-rule-card__index">Rule {idx + 1}</span>
                      <label className="ht-toggle" title={rule.enabled === false ? "Rule is disabled" : "Rule is enabled"}>
                        <input
                          type="checkbox"
                          checked={rule.enabled !== false}
                          onChange={(e) => updateHomeTitleRule(rule.id, { enabled: e.target.checked })}
                        />
                        <span>{rule.enabled === false ? "Disabled" : "Enabled"}</span>
                      </label>
                      <button
                        type="button"
                        className="ht-rule-card__remove"
                        onClick={() => removeHomeTitleRule(rule.id)}
                        title="Remove rule"
                        aria-label="Remove rule"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="ht-rule-card__body">
                      <div className="ht-field">
                        <label className="ht-label" htmlFor={`ht-priority-${rule.id}`}>Priority</label>
                        <input
                          id={`ht-priority-${rule.id}`}
                          type="number"
                          className="ht-input mono"
                          min="0"
                          value={rule.priority ?? 0}
                          onChange={(e) => updateHomeTitleRule(rule.id, { priority: Number(e.target.value) })}
                        />
                      </div>

                      <div className="ht-field">
                        <label className="ht-label" htmlFor={`ht-type-${rule.id}`}>Rule type</label>
                        <select
                          id={`ht-type-${rule.id}`}
                          className="ht-input"
                          value={rule.type}
                          onChange={(e) => updateHomeTitleRule(rule.id, { type: e.target.value })}
                        >
                          {HOME_TITLE_RULE_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>

                      {info.needsMatch && (
                        <div className="ht-field">
                          <label className="ht-label" htmlFor={`ht-match-${rule.id}`}>Match value</label>
                          <input
                            id={`ht-match-${rule.id}`}
                            type="text"
                            className="ht-input"
                            value={rule.match || ""}
                            placeholder={info.matchPlaceholder}
                            onChange={(e) => updateHomeTitleRule(rule.id, { match: e.target.value })}
                          />
                        </div>
                      )}

                      <div className="ht-field ht-field--full">
                        <label className="ht-label" htmlFor={`ht-title-${rule.id}`}>Title to show</label>
                        <input
                          id={`ht-title-${rule.id}`}
                          type="text"
                          className="ht-input"
                          value={rule.title || ""}
                          placeholder="Title shown to matching visitors"
                          onChange={(e) => updateHomeTitleRule(rule.id, { title: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </AdminPanel>
  );
}

export default HomeTitle;
