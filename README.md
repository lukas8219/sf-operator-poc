# ServerFramework EventSubscriptions Operator
Operator to manage, control and operate the ServerFramework Eventsubscriptions filters. Exposing a CRD for a LumaQueue.
- Visibility into filters via K8s
- Removes need for Redis and ephemeral storage
- Makes it possible for IAM in Kubernetes to control access to eventsubscriptions
- Automate removal of orphan queues in RabbitMQ
- [TBD] Offers source-control of queue filters
    - Could be done via exposing a HelmChart

# Setup using K3d
### How to Run the operator
```zsh
brew install k3d
k3d cluster create --api-port 6550 -p "8081:80@loadbalancer" --agents 1
node src/api.js
```

This should initilize the CRD and the local cluster

Via Postman hit on the current APIs

PUT -> `/subscriptions/:namespace`

```json
{
    "service": "followup-service",
    "queue": "LastMessageUpdatedAfterYou",
    "filters": [
        { "assignee": { "$whenDirty": true } },
        "['chat'].includes(ref)",
        "name === 'john'"
    ]
}
```

GET -> `/subscriptions/:namespace`

Returns
```json
[
    {
        "apiNamespace": "api:chatActivities:update",
        "filters": [
            "{\"assignee\":{\"$whenDirty\":true}}",
            "['chat'].includes(ref)",
            "name === 'lucas'"
        ],
        "queue": "LastMessageUpdatedAfterYou",
        "service": "pubsub-service"
    }
]
```
