import React from 'react';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import './Privacy.css';

const Privacy = () => {
    return (<>
        <Header />
        <div className='privacy'>
            <div className='privacy-title'>Privacy Policy</div>
            <div className='privacy-body'>
                <div className='privacy-body-title'>What information do we collect?</div>
                <div className='privacy-body-text'>We collect information from you when you register on our site or fill out a form.</div>
                <div className='privacy-body-text'>When ordering or registering on our site, as appropriate, you may be asked to enter your: name, e-mail address, or phone number.</div>
                <div className='privacy-body-text'>You may, however, visit our site anonymously.</div>
                <div className='privacy-body-title'>What do we use your information for?</div>
                <div className='privacy-body-text'>Any of the information we collect from you may be used in one of the following ways:</div>
                <div className='privacy-body-text'>◽To personalize your experience (your information helps us to better respond to your individual needs)</div>
                <div className='privacy-body-text'>◽To improve our website (we continually strive to improve our website offerings based on the information and feedback we receive from you)</div>
                <div className='privacy-body-text'>◽To improve customer service (your information helps us to more effectively respond to your customer service requests and support needs)</div>
                <div className='privacy-body-text'>◽To send periodic emails</div>
                <div className='privacy-body-title'>How do we protect your information?</div>
                <div className='privacy-body-text'>We implement a variety of security measures to maintain the safety of your personal information when you enter, submit, or access your personal information.</div>
                <div className='privacy-body-title'>Do we use cookies?</div>
                <div className='privacy-body-text'>We do not use cookies.</div>
                <div className='privacy-body-title'>Do we disclose any information to outside parties?</div>
                <div className='privacy-body-text'>We do not sell, trade, or otherwise transfer to outside parties your provided information.</div>
            </div>
        </div>
        <Footer />
    </>);
};

export default Privacy;