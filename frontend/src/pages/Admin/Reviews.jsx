import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import dataService from "../../features/data/dataService.js";
import { formatTimestamp } from "./adminShared";

function Reviews() {
  const { user } = useSelector((state) => state.data);

  const [allData, setAllData] = useState(null);
  const [allDataLoading, setAllDataLoading] = useState(false);

  const fetchAllData = useCallback(async (force = false) => {
    if (!user?.token || (allData && !force)) return;
    setAllDataLoading(true);
    try {
      const data = await dataService.getAllData(user.token);
      setAllData(data);
    } catch { /* handled by service */ }
    finally { setAllDataLoading(false); }
  }, [user, allData]);

  useEffect(() => {
    fetchAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ratingsAndReviews = useMemo(() => {
    if (!allData) return [];
    return allData
      .filter(item => item.text && (item.text.includes('Review:') || item.text.includes('Rating:')) && item.text.includes('User:'))
      .map(item => {
        const parts = {};
        (item.text || '').split('|').forEach(p => {
          const [k, ...v] = p.split(':');
          if (k && v.length) parts[k.toLowerCase()] = v.join(':');
        });
        return {
          id: item.id || item._id,
          title: parts.review || 'Untitled',
          category: parts.category || 'General',
          rating: parts.rating || 'N/A',
          content: parts.content || '',
          user: parts.user || 'Anonymous',
          createdAt: item.createdAt,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [allData]);

  const ts = formatTimestamp;

  return (
    <section className="admin-section-tile">
      <h2>Ratings &amp; Reviews</h2>

      {allDataLoading && <div className="admin-loading">Loading...</div>}
      {!allDataLoading && ratingsAndReviews.length > 0 ? (
        <div className="table-scroll-container">
        <table className="admin-table compact-table">
          <thead><tr>
            <th>Title</th><th>Rating</th><th>Category</th><th>User</th><th>Content</th><th>Date</th>
          </tr></thead>
          <tbody>
            {ratingsAndReviews.map(review => (
              <tr key={review.id}>
                <td><strong>{review.title}</strong></td>
                <td><span className="rating-badge">{'⭐'.repeat(parseInt(review.rating) || 0)} {review.rating}</span></td>
                <td><span className="category-badge">{review.category}</span></td>
                <td>{review.user}</td>
                <td>{review.content.length > 120 ? review.content.substring(0, 120) + '...' : review.content}</td>
                <td>{ts(review.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        !allDataLoading && <p className="admin-no-data">No ratings or reviews found</p>
      )}
    </section>
  );
}

export default Reviews;
