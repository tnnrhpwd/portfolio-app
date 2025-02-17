const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const asyncHandler = require('express-async-handler');

// Create a new customer
const createCustomer = asyncHandler(async (req, res) => {
    const { email, name } = req.body;
    const customer = await stripe.customers.create({ email, name });
    res.status(200).json(customer);
});

// Create a setup intent to save payment method
const createSetupIntent = asyncHandler(async (req, res) => {
    const { customerId } = req.body;
    const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
    });
    res.status(200).json(setupIntent);
});

// Create an invoice at the end of the month
const createInvoice = asyncHandler(async (req, res) => {
    const { customerId, amount, description } = req.body;
    await stripe.invoiceItems.create({
        customer: customerId,
        amount,
        currency: 'usd',
        description,
    });
    const invoice = await stripe.invoices.create({
        customer: customerId,
        auto_advance: true,
    });
    res.status(200).json(invoice);
});

// Subscribe customer to a membership plan
const subscribeCustomer = asyncHandler(async (req, res) => {
    const { customerId, membershipType } = req.body;
    const priceId = membershipType === 'Pro' ? 'price_pro_plan' : 'price_basic_plan';
    const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
    });
    res.status(200).json(subscription);
});

const handleWebhook = asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    switch (event.type) {
        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            // Handle successful payment
            break;
        // ... handle other event types
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.status(200).send();
});

module.exports = { handleWebhook, createCustomer, createSetupIntent, createInvoice, subscribeCustomer };