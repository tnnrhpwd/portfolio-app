// The service file only makes the http request and sends the data back to user and local storage.
// Exported to the Slice
import axios from 'axios';  // import ability to make http request
import { toast } from 'react-toastify'; // import toast notifications
const devMode = (process.env.NODE_ENV === 'development')

// const API_URL = 'https://mern-plan-web-service.onrender.com/api/data/';  // sends base http request here
const API_URL = devMode ? '/api/data/' : 'https://mern-plan-web-service.onrender.com/api/data/';
if (devMode) { console.log("Warning: Running in development mode. Remember to start backend.") }

const handleTokenExpiration = (error) => {
    console.log('DataService Error:', error);
    console.log('Error response:', error.response?.data);
    console.log('Error status:', error.response?.status);
    
    if (error.response && error.response.status === 401) {
        const errorData = error.response.data;
        
        // Handle different formats of error responses
        if (errorData === 'Not authorized, token expired' || 
            (errorData && errorData.dataMessage === 'Not authorized, token expired') ||
            (errorData && errorData.message && errorData.message.includes('expired'))) {
            console.log('Token expired, removing user from localStorage');
            localStorage.removeItem('user');
        } else if (errorData === 'Not authorized' ||
                  (errorData && errorData.dataMessage === 'Not authorized') ||
                  (errorData && errorData.dataMessage === 'Not authorized, no token')) {
            console.log('Authentication failed, removing user from localStorage');
            localStorage.removeItem('user');
        }
    } else if (error.response && error.response.status === 402) {
        // Handle API usage limit errors
        const errorData = error.response.data;
        
        if (errorData && errorData.error === 'API usage limit reached') {
            // Show specific toast message based on the reason
            if (errorData.reason === 'Free users cannot use paid APIs') {
                toast.error('🚀 Upgrade to Flex or Premium to access AI-powered features!', {
                    position: 'top-center',
                    autoClose: 5000,
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: true,
                    draggable: true,
                });
            } else if (errorData.reason === 'Would exceed usage limit') {
                const currentUsage = errorData.currentUsage?.toFixed(4) || '0.0000';
                const limit = errorData.limit?.toFixed(2) || '0.00';
                toast.warning(`💸 Monthly API limit reached! Used: $${currentUsage} / $${limit}. Upgrade for more usage!`, {
                    position: 'top-center',
                    autoClose: 7000,
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: true,
                    draggable: true,
                });
            } else {
                toast.error(`🔒 ${errorData.reason || 'API usage limit reached'}`, {
                    position: 'top-center',
                    autoClose: 5000,
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: true,
                    draggable: true,
                });
            }
        } else {
            toast.error('🔒 API usage limit reached. Please upgrade your plan!', {
                position: 'top-center',
                autoClose: 5000,
                hideProgressBar: false,
                closeOnClick: true,
                pauseOnHover: true,
                draggable: true,
            });
        }
    }
    throw error;
}

// Create new data
const createData = async (dataData, token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    }

    console.log('Calling POST URL:', API_URL);
    console.log('Calling POST Data:', dataData);
    
    // Only log FormData contents if it's actually FormData
    if (dataData instanceof FormData) {
        console.log('FormData contents in dataService:');
        for (const pair of dataData.entries()) {
          console.log(pair[0] + ', ' + pair[1]);
        }
    } else {
        console.log('Object data in dataService:', dataData);
    }
    
    console.log('Config:', config); // Log the config object

    try {
        const response = await axios.post(API_URL, dataData, config)
        return response.data
    } catch (error) {
        handleTokenExpiration(error);
    }
}

// Get all data
const getData = async (dataData, token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        params: dataData, // Include dataData as query parameters
    }

    console.log('Calling GET URL:', API_URL);
    console.log('Calling GET Params:', dataData);

    try {
        const response = await axios.get(API_URL, config)
        console.log('Response:', response.data);
        return response.data
    } catch (error) {
        handleTokenExpiration(error);
    }
}

// Get Public data
const getPublicData = async (dataData) => {
    const config = {
        params: dataData, // Include dataData as query parameters
    }

    console.log('Calling GET URL:', API_URL + 'public');
    console.log('Calling GET Params:', dataData);

    try {
        const response = await axios.get(API_URL + 'public', config);
        return response.data;
    } catch (error) {
        handleTokenExpiration(error);
    }
}

// Get all data (admin)
const getAllData = async (token) => {
    const config = {
        headers: { Authorization: `Bearer ${token}` },
    }
    console.log('Calling GET URL:', API_URL + 'all/admin/');
    try {
        const response = await axios.get(API_URL + 'all/admin/', config);
        return response.data;
    } catch (error) {
        handleTokenExpiration(error);
    }
}

// Update user data
const updateData = async (dataData, token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    }

    console.log('Calling PUT URL:', API_URL + dataData.id);
    console.log('Calling PUT Data:', dataData);

    try {
        const response = await axios.put(API_URL + dataData.id, dataData, config)
        return response.data
    } catch (error) {
        handleTokenExpiration(error);
    }
}

// Delete user data
const deleteData = async (dataId, token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    }

    console.log('Calling DELETE URL:', API_URL + dataId);

    try {
        const response = await axios.delete(API_URL + dataId, config)
        return response.data
    } catch (error) {
        handleTokenExpiration(error);
    }
}

// Compress data
const compressData = async (dataData, token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    }

    console.log('Calling POST URL:', API_URL + 'compress');
    console.log('Calling POST Data:', dataData);

    try {
        const response = await axios.post(API_URL + 'compress', dataData, config);
        return response.data;
    } catch (error) {
        handleTokenExpiration(error);
    }
}

// Fetch payment methods
const getPaymentMethods = async (token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };

    try {
        const response = await axios.get(API_URL + 'pay-methods', config);
        return response.data;
    } catch (error) {
        handleTokenExpiration(error);
    }
};

// Delete payment method
const deletePaymentMethod = async (id, token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };

    try {
        const response = await axios.delete(API_URL + `pay-methods/${id}`, config);
        return response.data;
    } catch (error) {
        handleTokenExpiration(error);
    }
};

// Create customer
const createCustomer = async (customerData, token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };

    try {
        const response = await axios.post(API_URL + 'create-customer', customerData, config);
        return response.data;
    } catch (error) {
        handleTokenExpiration(error);
    }
};

// Post payment method
const postPaymentMethod = async (paymentData, token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };

    try {
        const response = await axios.post(API_URL + 'pay-methods', paymentData, config);
        return response.data;
    } catch (error) {
        handleTokenExpiration(error);
    }
};

// Subscribe customer to a membership plan
const subscribeCustomer = async (subscriptionData, token) => {
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };

    try {
        const response = await axios.post(API_URL + 'subscribe-customer', subscriptionData, config);
        return response.data;
    } catch (error) {
        handleTokenExpiration(error);
    }
};

// Get user subscription
const getUserSubscription = async (token) => {
    console.log('dataService.getUserSubscription called');
    console.log('Token provided:', !!token);
    console.log('Token preview:', token ? token.substring(0, 50) + '...' : 'No token');
    
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };

    console.log('Calling GET URL:', API_URL + 'subscription');
    console.log('Request config:', config);

    try {
        const response = await axios.get(API_URL + 'subscription', config);
        console.log('getUserSubscription response:', response.data);
        return response.data;
    } catch (error) {
        console.error('getUserSubscription service error:', error);
        console.error('Error response data:', error.response?.data);
        console.error('Error response status:', error.response?.status);
        console.error('Error response headers:', error.response?.headers);
        handleTokenExpiration(error);
    }
};

// Register user
const register = async (userData) => {
    console.log('Calling POST URL:', API_URL + 'register');
    console.log('Calling POST Data:', userData);

    try {
        const response = await axios.post(API_URL + 'register', userData)  // send user data to /api/data/ -- creates a new user
        if (response.data) {
            localStorage.setItem('user', JSON.stringify(response.data))   // catches the return data from POST -- contains the JSON Web Token -- logs user in
        }
        return response.data    // return JWT
    } catch (error) {
        handleTokenExpiration(error);
    }
}
  
// Login user
const login = async (userData) => {
    console.log('Calling POST URL:', API_URL + 'login');
    console.log('Calling POST Data:', userData);

    try {
        const response = await axios.post(API_URL + 'login', userData)    // send user data to /api/data/login/
        if (response.data) {
            localStorage.setItem('user', JSON.stringify(response.data))     // catches the return data from POST -- contains the JSON Web Token
        }
        return response.data
    } catch (error) {
        handleTokenExpiration(error);
    }
}
  
// Get membership pricing (public endpoint)
const getMembershipPricing = async () => {
    try {
        const response = await axios.get(API_URL + 'membership-pricing');
        return response.data;
    } catch (error) {
        console.error('Error fetching membership pricing:', error);
        throw error;
    }
}

// Get user API usage statistics
const getUserUsage = async (token) => {
    console.log('Getting user API usage');
    console.log('Token preview:', token ? token.substring(0, 50) + '...' : 'No token');
    
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };

    console.log('Calling GET URL:', API_URL + 'usage');
    console.log('Request config:', config);

    try {
        const response = await axios.get(API_URL + 'usage', config);
        console.log('getUserUsage response:', response.data);
        return response.data;
    } catch (error) {
        console.error('getUserUsage service error:', error);
        console.error('Error response data:', error.response?.data);
        console.error('Error response status:', error.response?.status);
        console.error('Error response headers:', error.response?.headers);
        handleTokenExpiration(error);
    }
};

// Get user storage usage statistics
const getUserStorage = async (token) => {
    console.log('Getting user storage usage');
    console.log('Token preview:', token ? token.substring(0, 50) + '...' : 'No token');
    
    const config = {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };

    console.log('Calling GET URL:', API_URL + 'storage');
    console.log('Request config:', config);

    try {
        const response = await axios.get(API_URL + 'storage', config);
        console.log('getUserStorage response:', response.data);
        return response.data;
    } catch (error) {
        console.error('getUserStorage service error:', error);
        console.error('Error response data:', error.response?.data);
        console.error('Error response status:', error.response?.status);
        console.error('Error response headers:', error.response?.headers);
        handleTokenExpiration(error);
    }
};

// Logout user
const logout = () => {
    localStorage.removeItem('user')
}

const dataService = {
    createData,
    getData,
    getPublicData,
    getAllData,
    updateData,
    deleteData,
    compressData,
    getPaymentMethods,
    deletePaymentMethod,
    createCustomer,
    postPaymentMethod,
    subscribeCustomer,
    getUserSubscription, // Note: Changed from plural to match implementation
    getUserUsage,
    getUserStorage,
    getMembershipPricing,
    register,
    login,
    logout,
}

export default dataService;
