const express = require('express');
const crypto = require('crypto');
const EventSubscriptionsOperator = require('./operator');
const app = express();
app.use(express.json());
const operator = new EventSubscriptionsOperator();

app.get(`/subscriptions/:namespace`, async (req, res) => {
    const { namespace } = req.params;
    try {
        const subscriptions = await operator.listEventSubscription(namespace);
        if(!subscriptions.length){
            return res.status(404).json({ message: 'Not found' });
        }
        return res.status(200).json(subscriptions);
    } catch (err){
        return res.status(500).json({ message: 'Unexpected error occured', err });
    }
});

app.put(`/subscriptions/:namespace`, async (req, res) => {
    try {
        const { filters, queue, service } = req.body;
        const { namespace } = req.params;
    
        const newOrUpdatedSubscription = {
            filters,
            queue,
            service,
        }

        const hashsum = hashsumSubscription(newOrUpdatedSubscription);

        const subscription = await operator.upsertEventSubscription({ namespace, filters, queue, service, hashsum });
    
        return res.status(200).json(subscription);
     } catch(err) {
        console.error(err);
        return res.status(500).json({ message: 'unexpected', err });
     }
});



function stringifyFilters(filters){
    return JSON.stringify(typeof filters !== 'string' ? [filters].map(JSON.stringify) : filters);
}

function hashsumSubscription({ queue, service, filters }){
    const stringifiedSubscription = [service,queue, stringifyFilters(filters)].join(':');
    return `${crypto.createHash('md5').update(stringifiedSubscription).digest('hex')}`;
}


operator.start();
app.listen(8080, () => console.log('listening in 8080'));

module.exports = app;