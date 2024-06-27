const { default: Operator, ResourceEventType } = require('@dot-i/k8s-operator');
const Path = require('path');
const https = require('https');
const axios = require('axios');
const { kebabize } = require('./utils');

function log(){
    return console.log(...arguments);
}

module.exports = class EventSubscriptionsOperator extends Operator {
    constructor(){
        super({
            info: log,
            error: log,
            debug: log,
            warn: log,
        })
    }
    async init(){
        const crdFile = Path.resolve(__dirname, 'eventsubscriptions-crd.yaml');
        const { group, versions, plural } = await this.registerCustomResourceDefinition(crdFile);
        log(group, versions, plural);
        this._group = group;
        this._version = versions[versions.length-1];
        this._plural = plural;
        const apiUrl = this.getCustomResourceApiUri(this._group, this._version.name, this._plural, 'default');
        const config = {
            baseURL: apiUrl,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        };
        await this.applyAxiosKubeConfigAuth(config);
        this.__client = axios.create(config);
        await this.watchResource(group, versions[versions.length-1].name, plural, (event) => {
            switch(event.type) {
                case ResourceEventType.Added:
                    break;
                case ResourceEventType.Modified:
                    break;
                    //handle modification
                case ResourceEventType.Deleted:
                    break;
                    //handle deletion
                default:
                    //error
                    break;
            }
        });
    }

    async createEventSubscription({ namespace, service, queue, filters, hashsum }){
        const name = [kebabize(service), kebabize(queue)].join('-');
        const { data } = await this.__client.post(`/${name}`, {
            apiVersion: `${this._group}/${this._version.name}`,
            kind: 'EventSubscription',
            metadata: {
                name: `${name}`,
            },
            spec:{
                service,
                queue,
                filters: filters.map((f) => typeof f === 'string' ? f : JSON.stringify(f)),
                apiNamespace: namespace,
                filtersHashsum: hashsum,
            }
        });
        return data.spec;
    }

    async getEventSubscription({ service, queue }){
        const name = [kebabize(service), kebabize(queue)].join('-');
        const { data } = await this.__client.get(`/${name}`);
        return data.spec;
    }

    async upsertEventSubscription({ namespace, service, queue, filters, hashsum }){
        try {
            const existingEventSubscription = await this.getEventSubscription({ namespace, service, queue, filters });

            if(existingEventSubscription.filtersHashsum === hashsum) {
                return existingEventSubscription;
            }
            
            const name = [kebabize(service), kebabize(queue)].join('-');
            const { data } = await this.__client.patch(`/${name}`, {
                spec:{
                    service,
                    queue,
                    filters: filters.map((f) => typeof f === 'string' ? f : JSON.stringify(f)),
                    apiNamespace: namespace,
                    filtersHashsum: hashsum,
                }
            }, { headers: { 'Content-Type': 'application/merge-patch+json'}});
            return data.spec;
        } catch (err){
            if(err.response.status === 404){
                return this.createEventSubscription({ namespace, service, queue, filters, hashsum });
            }
            throw err;
        }
    }

    async listEventSubscription(namespace){
        const { data } = await this.__client.get(`/`);
        return data.items.map((e) => e.spec).filter((subscription) => subscription.apiNamespace === namespace);
    }
}