import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import ScrollableTable from '../../components/Admin/ScrollableTable.jsx';
import deepStorageApi from '../../services/deepStorageApi';
import './DeepStorage.css';

// Same hardcoded admin id used to gate the /admin page (Admin.jsx) — the
// server independently enforces this via ADMIN_USER_ID, this is only used
// to decide whether to render the "Regenerate" button.
const ADMIN_USER_ID = '6770a067c725cbceab958619';

const HEADERS = [
  { key: 'displayName', label: 'Item' },
  { key: 'name', label: 'Item ID' },
  { key: 'numericId', label: 'Numeric ID' },
  { key: 'maxStackSize', label: 'Max Stack' },
  { key: 'category', label: 'Category' },
];

// Column used for the "just the item ID" export (e.g. `acacia_button`).
const ID_ONLY_COLUMNS = [{ key: 'name', label: 'Item ID' }];

const escapeCsv = (val) => {
  const str = String(val ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

/** Build a CSV string from the given rows for the given { key, label } columns. */
function toCsv(rows, columns) {
  const lines = [
    columns.map((c) => escapeCsv(c.label)).join(','),
    ...rows.map((row) => columns.map((c) => escapeCsv(row[c.key])).join(',')),
  ];
  return lines.join('\n');
}

function downloadCsv(rows, columns, filenamePrefix) {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function DeepStorage() {
  const { user } = useSelector((state) => state.data);
  const isAdmin = !!user && String(user._id) === ADMIN_USER_ID;

  const [items, setItems] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [visibleRows, setVisibleRows] = useState([]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await deepStorageApi.getItems();
      setItems(data.items || []);
      setGeneratedAt(data.generatedAt || null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load item catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleRegenerate = useCallback(async () => {
    if (!user?.token) return;
    const confirmed = window.confirm(
      'Re-fetch the item list from the Microsoft Docs source and rebuild the catalog? This may take a few seconds.'
    );
    if (!confirmed) return;

    setRegenerating(true);
    try {
      const data = await deepStorageApi.regenerate(user.token);
      setItems(data.items || []);
      setGeneratedAt(data.generatedAt || null);
      toast.success(`Regenerated ${data.totalKept} stackable items.`);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to regenerate item list');
    } finally {
      setRegenerating(false);
    }
  }, [user]);

  const filterFn = useCallback((item, searchText) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return (
      item.displayName.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      String(item.numericId).includes(q)
    );
  }, []);

  const renderRow = useCallback(
    (item, index) => (
      <tr key={item.name || index}>
        <td>{item.displayName}</td>
        <td><code>{item.name}</code></td>
        <td>{item.numericId}</td>
        <td>{item.maxStackSize}</td>
        <td>{item.category}</td>
      </tr>
    ),
    []
  );

  const lastGeneratedLabel = useMemo(() => {
    if (!generatedAt) return 'Never generated';
    return new Date(generatedAt).toLocaleString();
  }, [generatedAt]);

  const alphabetCounts = useMemo(() => {
    const counts = {};
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') counts[letter] = 0;
    let other = 0;
    for (const item of items) {
      const first = (item.displayName || '').trim().charAt(0).toUpperCase();
      if (counts[first] !== undefined) counts[first] += 1;
      else other += 1;
    }
    return { counts, other };
  }, [items]);

  return (
    <>
      <Header />
      <div className="deepstorage-container">
        <section className="deepstorage-hero">
          <h1>Deep Storage</h1>
          <p>
            A searchable, sortable, and filterable catalog of every stackable item
            obtainable in normal Minecraft: Bedrock Edition survival gameplay —
            handy for planning storage systems, sorting machines, and item frames.
          </p>
          <div className="deepstorage-meta">
            <span>Last generated: {lastGeneratedLabel}</span>
            <span>{items.length.toLocaleString()} items</span>
          </div>
          <div className="deepstorage-actions">
            <button
              type="button"
              className="deepstorage-btn"
              onClick={() => downloadCsv(visibleRows.length ? visibleRows : items, HEADERS, 'deepstorage-items')}
              disabled={loading || items.length === 0}
            >
              ⬇ Export CSV
            </button>
            <button
              type="button"
              className="deepstorage-btn"
              onClick={() => downloadCsv(visibleRows.length ? visibleRows : items, ID_ONLY_COLUMNS, 'deepstorage-item-ids')}
              disabled={loading || items.length === 0}
              title="Export just the Item ID column (e.g. acacia_button)"
            >
              ⬇ Export Item IDs Only
            </button>
            {isAdmin && (
              <button
                type="button"
                className="deepstorage-btn deepstorage-btn-admin"
                onClick={handleRegenerate}
                disabled={regenerating}
                title="Re-run the item generator against the live source"
              >
                {regenerating ? 'Regenerating…' : '⟳ Regenerate List'}
              </button>
            )}
          </div>
        </section>

        {!loading && !error && items.length > 0 && (
          <details className="deepstorage-alphabet">
            <summary>Items per letter (A–Z)</summary>
            <div className="deepstorage-alphabet-grid">
              {Object.entries(alphabetCounts.counts).map(([letter, count]) => (
                <div key={letter} className="deepstorage-alphabet-cell">
                  <span className="deepstorage-alphabet-letter">{letter}</span>
                  <span className="deepstorage-alphabet-count">{count}</span>
                </div>
              ))}
              {alphabetCounts.other > 0 && (
                <div className="deepstorage-alphabet-cell">
                  <span className="deepstorage-alphabet-letter">#</span>
                  <span className="deepstorage-alphabet-count">{alphabetCounts.other}</span>
                </div>
              )}
            </div>
          </details>
        )}

        <section className="deepstorage-table-section">
          {loading ? (
            <div className="deepstorage-status">Loading item catalog…</div>
          ) : error ? (
            <div className="deepstorage-status deepstorage-error">{error}</div>
          ) : items.length === 0 ? (
            <div className="deepstorage-status">
              No item list has been generated yet.{' '}
              {isAdmin
                ? 'Press "Regenerate List" above to build it.'
                : 'Please check back soon — an admin needs to generate it first.'}
            </div>
          ) : (
            <ScrollableTable
              headers={HEADERS}
              data={items}
              renderRow={renderRow}
              filterFn={filterFn}
              onFilteredDataChange={setVisibleRows}
            />
          )}
        </section>
      </div>
      <Footer />
    </>
  );
}

export default DeepStorage;
