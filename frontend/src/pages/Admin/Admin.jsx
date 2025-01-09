import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { getAllData } from "../../features/data/dataSlice";
import "./Admin.css";

function Admin() {
  const dispatch = useDispatch();
  const { data, dataIsLoading, dataIsError } = useSelector((state) => state.data);

  useEffect(() => {
    dispatch(getAllData());
  }, [dispatch]);

  return (
    <>
      <Header />
      <div className="admin-container">
        <section className="admin-section-tile">
          <h2>Administrator Panel</h2>
          {dataIsLoading && <p>Loading...</p>}
          {dataIsError && <p>Error loading data.</p>}
          {!dataIsLoading && data && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Data</th>
                  <th>Created At</th>
                  <th>Updated At</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(data) && data.map((item) => (
                  <tr key={item._id}>
                    <td>{item._id}</td>
                    <td>{item.data}</td>
                    <td>{item.createdAt}</td>
                    <td>{item.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <Footer />
    </>
  );
}

export default Admin;
