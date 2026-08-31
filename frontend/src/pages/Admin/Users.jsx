import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import dataService from "../../features/data/dataService.js";
import { formatTimestamp } from "./adminShared";
import { toast } from "react-toastify";

function Users() {
  const { user } = useSelector((state) => state.data);

  // ── Paginated users ──
  const [users, setUsers] = useState([]);
  const [usersPagination, setUsersPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [usersSearch, setUsersSearch] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [togglingSpecialId, setTogglingSpecialId] = useState(null);

  // ═══════════════ Fetch paginated users ═══════════════
  const fetchUsers = useCallback(async (page = 1) => {
    if (!user?.token) return;
    setUsersLoading(true);
    try {
      const res = await dataService.getAdminUsers(user.token, { page, limit: 30, search: usersSearch });
      setUsers(res.data);
      setUsersPagination(res.pagination);
    } catch { /* handled by service */ }
    finally { setUsersLoading(false); }
  }, [user, usersSearch]);

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══════════════ Toggle a user's Special status (unlimited API credits) ═══════════════
  const handleToggleSpecial = useCallback(async (u) => {
    if (!user?.token || togglingSpecialId) return;
    setTogglingSpecialId(u.id);
    try {
      const result = await dataService.toggleUserSpecial(user.token, u.id, !u.special);
      setUsers((prev) => prev.map((row) => (row.id === u.id ? { ...row, special: result.special } : row)));
      toast.success(`${u.nickname || u.email || 'User'} is now ${result.special ? '⭐ Special' : 'Normal'}`);
    } catch {
      toast.error('Failed to update special status');
    } finally {
      setTogglingSpecialId(null);
    }
  }, [user, togglingSpecialId]);

  const ts = formatTimestamp;

  return (
    <section className="admin-section-tile">
      <h2>User Management</h2>

      <div className="section-toolbar">
        <input
          type="text"
          className="admin-search"
          placeholder="Search users by email, name, or plan..."
          value={usersSearch}
          onChange={(e) => setUsersSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchUsers(1)}
        />
        <button className="btn-sm" onClick={() => fetchUsers(1)} disabled={usersLoading}>
          {usersLoading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {usersLoading && <div className="admin-loading">Loading users...</div>}
      {!usersLoading && users.length > 0 && (
        <>
          <div className="table-scroll-container">
          <table className="admin-table compact-table">
            <thead><tr>
              <th>Nickname</th><th>Email</th><th>Plan</th><th>Stripe ID</th><th>Joined</th>
            </tr></thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id || i}>
                  <td>{u.nickname || '—'}</td>
                  <td>{u.email}</td>
                  <td>
                    <span
                      className={`plan-badge plan-badge--clickable ${u.special ? 'plan-special' : `plan-${u.rank?.toLowerCase()}`}`}
                      onClick={() => handleToggleSpecial(u)}
                      role="button"
                      tabIndex={0}
                      title={u.special
                        ? 'Special — unlimited API credits. Click to revert to normal.'
                        : 'Click to grant Special status (unlimited API credits)'}
                    >
                      {togglingSpecialId === u.id ? '…' : (u.special ? '⭐ Special' : u.rank)}
                    </span>
                  </td>
                  <td className="mono">{u.stripeid ? u.stripeid.substring(0, 18) + '...' : '—'}</td>
                  <td>{ts(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="pagination">
            <button disabled={usersPagination.page <= 1} onClick={() => fetchUsers(usersPagination.page - 1)}>← Prev</button>
            <span>Page {usersPagination.page} of {usersPagination.totalPages} ({usersPagination.total} users)</span>
            <button disabled={usersPagination.page >= usersPagination.totalPages} onClick={() => fetchUsers(usersPagination.page + 1)}>Next →</button>
          </div>
        </>
      )}
      {!usersLoading && users.length === 0 && <p className="admin-no-data">No users found</p>}
    </section>
  );
}

export default Users;
