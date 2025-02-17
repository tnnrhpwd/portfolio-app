import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import axios from 'axios';

const stripePromise = loadStripe('your_stripe_public_key');

const StripePayment = ({ membershipType }) => {
    const stripe = useStripe();
    const elements = useElements();
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');

    const handleSubmit = async (event) => {
        event.preventDefault();

        const { data: customer } = await axios.post('/api/stripe/create-customer', { email, name });
        const { data: setupIntent } = await axios.post('/api/stripe/create-setup-intent', { customerId: customer.id });

        const { error } = await stripe.confirmCardSetup(setupIntent.client_secret, {
            payment_method: {
                card: elements.getElement(CardElement),
                billing_details: { name },
            },
        });

        if (error) {
            console.error(error);
        } else {
            await axios.post('/api/stripe/subscribe-customer', { customerId: customer.id, membershipType });
            console.log('Payment method saved and subscription created successfully');
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
            <CardElement />
            <button type="submit" disabled={!stripe}>Save Payment Method</button>
        </form>
    );
};

const StripePaymentWrapper = ({ membershipType }) => (
    <Elements stripe={stripePromise}>
        <StripePayment membershipType={membershipType} />
    </Elements>
);

export default StripePaymentWrapper;
