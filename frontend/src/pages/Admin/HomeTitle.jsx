import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import dataService from "../../features/data/dataService.js";
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

  return (
    <section className="admin-section-tile">
      <h2>Home Title Rules</h2>

      {homeTitleLoading && <div className="admin-loading">Loading home title settings...</div>}
      {homeTitleError && (
        <div className="admin-error">
          <span>{homeTitleError}</span>
          <button className="btn-sm btn-retry" onClick={fetchHomeTitleSettings}>↻ Retry</button>
        </div>
      )}
      {!homeTitleLoading && homeTitleSettings && (
        <>
          <p className="admin-help-text">
            Rules are evaluated in priority order (lowest number first); the first enabled rule whose
            condition matches the visitor wins. If nothing matches, the default title below is used.
          </p>

          <div className="section-toolbar">
            <label htmlFor="home-title-default" style={{ marginRight: 8 }}>Default title:</label>
            <input
              id="home-title-default"
              type="text"
              className="admin-search"
              value={homeTitleSettings.defaultTitle}
              onChange={(e) => setHomeTitleSettings((prev) => ({ ...prev, defaultTitle: e.target.value }))}
              placeholder="It's simple."
            />
          </div>

          <div className="table-scroll-container">
            <table className="admin-table compact-table">
              <thead>
                <tr>
                  <th>Enabled</th>
                  <th>Priority</th>
                  <th>Rule Type</th>
                  <th>Match Value</th>
                  <th>Title To Show</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {homeTitleSettings.rules.map((rule) => {
                  const info = homeTitleRuleTypeInfo(rule.type);
                  return (
                    <tr key={rule.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={rule.enabled !== false}
                          onChange={(e) => updateHomeTitleRule(rule.id, { enabled: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="mono"
                          style={{ width: 60 }}
                          value={rule.priority ?? 0}
                          onChange={(e) => updateHomeTitleRule(rule.id, { priority: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <select
                          className="type-select"
                          value={rule.type}
                          onChange={(e) => updateHomeTitleRule(rule.id, { type: e.target.value })}
                        >
                          {HOME_TITLE_RULE_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {info.needsMatch ? (
                          <input
                            type="text"
                            value={rule.match || ""}
                            placeholder={info.matchPlaceholder}
                            onChange={(e) => updateHomeTitleRule(rule.id, { match: e.target.value })}
                          />
                        ) : (
                          <span className="admin-no-data">n/a</span>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          value={rule.title || ""}
                          placeholder="Title shown to matching visitors"
                          onChange={(e) => updateHomeTitleRule(rule.id, { title: e.target.value })}
                        />
                      </td>
                      <td>
                        <button className="btn-sm btn-retry" onClick={() => removeHomeTitleRule(rule.id)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {homeTitleSettings.rules.length === 0 && (
            <p className="admin-no-data">No custom rules yet — add one below, or leave empty to always show the default title.</p>
          )}

          <div className="section-toolbar">
            <button className="btn-sm" onClick={addHomeTitleRule}>+ Add Rule</button>
            <button
              className="btn-sm btn-retry"
              onClick={handleSaveHomeTitleSettings}
              disabled={homeTitleSaving}
            >
              {homeTitleSaving ? "Saving…" : "Save Changes"}
            </button>
            {homeTitleUpdatedAt && (
              <span className="admin-no-data">Last saved: {ts(homeTitleUpdatedAt)}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default HomeTitle;
