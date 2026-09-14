import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import dataService from "../../features/data/dataService.js";
import AdminPanel from "../../components/Admin/AdminPanel.jsx";
import { useAdminReadout } from "./adminBarContext";
import { fmt, formatTimestamp } from "./adminShared";

function DataExplorer() {
  const { user } = useSelector((state) => state.data);

  // ── Paginated raw data ──
  const [rawData, setRawData] = useState([]);
  const [rawPagination, setRawPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [rawType, setRawType] = useState("");
  const [rawLoading, setRawLoading] = useState(false);

  const fetchRawData = useCallback(async (page = 1) => {
    if (!user?.token) return;
    setRawLoading(true);
    try {
      const res = await dataService.getAdminPaginatedData(user.token, {
        page, limit: 50, type: rawType || undefined,
      });
      setRawData(res.data);
      setRawPagination(res.pagination);
    } catch { /* handled by service */ }
    finally { setRawLoading(false); }
  }, [user, rawType]);

  useEffect(() => { fetchRawData(); }, [fetchRawData]);

  const ts = formatTimestamp;

  useAdminReadout(
    rawPagination.total > 0
      ? [
          { label: 'Records', value: fmt(rawPagination.total) },
          { label: 'Page', value: `${rawPagination.page}/${rawPagination.totalPages}` },
        ]
      : null
  );

  return (
    <AdminPanel
      title="Raw records"
      hint="Every row in the Simple table, unfiltered. Pick a type and load a page."
      tools={
        <>
          <select
            className="type-select"
            value={rawType}
            onChange={(e) => { setRawType(e.target.value); }}
            aria-label="Record type"
          >
            <option value="">All Types</option>
            <option value="user">Users</option>
            <option value="visitor">Visitors</option>
            <option value="bug">Bug Reports</option>
            <option value="review">Reviews</option>
            <option value="other">Other</option>
          </select>
          <button className="btn-sm" onClick={() => fetchRawData(1)} disabled={rawLoading}>
            {rawLoading ? 'Loading…' : 'Load'}
          </button>
        </>
      }
    >
      {rawLoading && <div className="admin-loading">Loading data...</div>}
      {!rawLoading && rawData.length > 0 && (
        <>
          <div className="table-scroll-container">
            <table className="admin-table compact-table">
              <thead><tr>
                <th>ID</th><th>Type</th><th>Text</th><th>Files</th><th>Created</th>
              </tr></thead>
              <tbody>
                {rawData.map((item, i) => (
                  <tr key={item.id || i}>
                    <td className="mono">{(item.id || '').substring(0, 12)}...</td>
                    <td><span className={`type-badge type-${item.type}`}>{item.type}</span></td>
                    <td>{item.text ? (item.text.length > 150 ? item.text.substring(0, 150) + '...' : item.text) : ''}</td>
                    <td>{item.files || ''}</td>
                    <td>{ts(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button disabled={rawPagination.page <= 1} onClick={() => fetchRawData(rawPagination.page - 1)}>← Prev</button>
            <span>Page {rawPagination.page} of {rawPagination.totalPages} ({fmt(rawPagination.total)} records)</span>
            <button disabled={rawPagination.page >= rawPagination.totalPages} onClick={() => fetchRawData(rawPagination.page + 1)}>Next →</button>
          </div>
        </>
      )}
      {!rawLoading && rawData.length === 0 && rawPagination.total === 0 && (
        <p className="admin-no-data">Pick a type and load a page to browse data</p>
      )}
    </AdminPanel>
  );
}

export default DataExplorer;
