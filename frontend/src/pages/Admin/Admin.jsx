import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useNavigate } from "react-router-dom";
import { getAllData } from "../../features/data/dataSlice";
import "./Admin.css";
import { toast } from 'react-toastify';

function Admin() {
  const { user, data, dataMessage, dataIsSuccess, dataIsLoading, dataIsError } = useSelector((state) => state.data);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [allObjectArray, setAllObjectArray] = useState([]);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    dispatch(getAllData());
  }, [dispatch]);

  useEffect(() => {
    if (!user) {  // if user is not logged in, redirect to login page
      navigate("/login");
    }
    if (user && user._id.toString() !== "6770a067c725cbceab958619") {  // if user is not an admin, redirect to home page
      toast.error("Only admin are allowed to use that URL.");
      console.error("Only admin are allowed to use that URL");
      navigate("/");
    }
  }, [user, navigate]);

  useEffect(() => {
    if (dataIsError) {
      console.error("Error fetching data:", dataMessage);
      toast.error("Error fetching data.");
    }
  }, [dataIsError]);

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
            <>
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
              </table>
              <div className="table-scroll-container">
                <table className="admin-table">
                  <tbody>
                    {Array.isArray(allObjectArray) &&
                      allObjectArray
                        .filter(item =>
                          typeof item.text === 'string' && item.text.toLowerCase().includes(searchText.toLowerCase())
                        )
                        .map((item) => (
                          <tr key={item._id} className="admin-table-row">
                            <td className="admin-table-row-text">{item._id || ''}</td>
                            <td className="admin-table-row-text">
                              {item.text ? (item.text.length > 200 ? item.text.substring(0, 200) + '...' : item.text) : ''}
                            </td>
                            <td className="admin-table-row-text">{item.files || ''}</td>
                            <td className="admin-table-row-text">{item.createdAt || ''}</td>
                            <td className="admin-table-row-text">{item.updatedAt || ''}</td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
      <Footer />
    </>
  );
}

export default Admin;
