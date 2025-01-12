import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { getAllData } from "../../features/data/dataSlice";
import "./Admin.css";
import { useState } from "react";

function Admin() {
  const dispatch = useDispatch();
  const { data, dataIsSuccess,  dataIsLoading, dataIsError } = useSelector((state) => state.data);
  const [allObjectArray, setAllObjectArray] = useState([]);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    dispatch(getAllData());
  }, [dispatch]);

  useEffect(() => {
    if (data) {
      setAllObjectArray(data);
      console.log('Retrieved all data:', data);
    }
  }, [data, dataIsSuccess]);

  return (
    <>
      <Header />
      <div className="admin-container">
        <section className="admin-section-tile">
          <h2>Administrator Panel</h2>
          {dataIsLoading && <p>Loading...</p>}
          {dataIsError && <p>Error loading data.</p>}
          <input
            type="text"
            placeholder="Search..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {!dataIsLoading && data && (
            <div className="table-scroll-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Text</th>
                    <th>Files</th>
                    <th>Created At</th>
                    <th>Updated At</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(allObjectArray) &&
                    allObjectArray
                      .filter(item =>
                        typeof item.text === 'string' && item.text.toLowerCase().includes(searchText.toLowerCase())
                      )
                      .map((item) => (
                        <tr key={item._id} className="admin-table-row">
                          {item._id && <td className="admin-table-row-text">{item._id}</td>}
                          {item.text && (
                            <td className="admin-table-row-text">
                              {item.text.length > 50 ? item.text.substring(0, 50) + '...' : item.text}
                            </td>
                          )}
                          {item.files && <td className="admin-table-row-text">{item.files}</td>}
                          {item.createdAt && <td className="admin-table-row-text">{item.createdAt}</td>}
                          {item.updatedAt && <td className="admin-table-row-text">{item.updatedAt}</td>}
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <Footer />
    </>
  );
}

export default Admin;
