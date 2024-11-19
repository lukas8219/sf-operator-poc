const { default: Operator, ResourceEventType } = require('@dot-i/k8s-operator');
const Path = require('path');
const https = require('https');
const axios = require('axios');
const { kebabize } = require('./utils');
const RabbitMQClient = require('http-rabbitmq-manager');
const { promisify } = require('util');

/* TODO:
Externalize credentials and configs
*/
const rabbitClient = RabbitMQClient.client();

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
        try {
            const crdFile = Path.resolve(__dirname, '../manifests/eventsubscriptions-crd.yaml');
            const { group, versions, plural } = await this.registerCustomResourceDefinition(crdFile);
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
            await this.#watch(group, versions[versions.length-1].name, plural);
        } catch(err){
            this.logger.error('Error registering custom resource definition', err);
            process.exit(1);
        }
    }

    async #watch(group, version, plural){
        try {
            await this.watchResource(group, version, plural, async (event) => {
                switch(event.type) {
                    case ResourceEventType.Added:
                        this.logger.debug('Added', event.object);
                        await this.createQueue(event);
                        this.handleResourceFinalizer(event, 'removeorphaned.luma.serverframework.com', this.handleOrphanedEventSubscription.bind(this));
                        /*
                        TODO:
                        - Create RabbitMQ queue with `uid` as argument
                        - Create binding with `uid` as argument
                        */
                        break;
                    case ResourceEventType.Modified:
                        this.logger.debug('Modified', event.object);
                        this.handleResourceFinalizer(event, 'removeorphaned.luma.serverframework.com', this.handleOrphanedEventSubscription.bind(this));
                        /*
                        TODO:
                        - If `name` changed, delete old queue (by uid) and binding (by uid)
                        - List all deployments replicas and call PUT -> /eventsubscription/:namespace/:name on each of them
                        */
                        break;
                    default:
                        //error
                        break;
                }
            });
        } catch(err){
            this.logger.error('Error watching resource', err);
        }
    }

    async createQueue(event){
        const { uid, name } = event.object.metadata;
        const queueName = this.#createQueueName(event);
        try {
            await promisify(rabbitClient.createQueue).bind(rabbitClient)({ queue: queueName, vhost: '/', arguments: { 'eventsubscription-uid': uid } });
            this.logger.info(`eventsubscription ${name} uid:${uid} -> Created RabbitMQ queue ${queueName}`);
        } catch(err){
            this.logger.error(`eventsubscription ${name} uid:${uid} -> Error creating RabbitMQ queue ${name}`, err);
        }
    }

    async deleteQueue(event){
        const { name, uid } = event.object.metadata;
        const queueName = this.#createQueueName(event);
        try {
            await promisify(rabbitClient.deleteQueue).bind(rabbitClient)({ queue: queueName, vhost: '/' });
            this.logger.info(`eventsubscription ${name} uid:${uid} -> Deleted RabbitMQ queue ${queueName}`);
        } catch(err){
            this.logger.error(`eventsubscription ${name} uid:${uid} -> Error deleting RabbitMQ queue ${name}`, err);
        }
    }

    #createQueueName(event){
        const { service, queue, apiNamespace } = event.object.spec;
        return ['v4:eventsubscription', kebabize(apiNamespace), kebabize(service), kebabize(queue), 'queue'].join(':');
    }

    async handleOrphanedEventSubscription(event){
        this.logger.debug('Removing orphaned event subscription', event.object);
        await this.deleteQueue(event);
        this.setResourceFinalizers(event.meta, []);
        return true;
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