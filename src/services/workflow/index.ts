/*
When an AccessRequest is first made, a Kong Consumer should be created (if not already existing).
And then a SyncConsumersByNamespace should be done to pull changes from Kong into KeystoneJS.

When approved, determine whether the credential issuing is automatic or 

Workflow:

- initializeConsumer()
- requestApproved()
- credentialIssued()
- issueCredential()


Scenarios:
- Public API - Try it
- Basic Auth / API Key w/ ACL - Test Environment : Request Access -> RESULT: Get added to a group
- Basic Auth / API Key w/ ACL - Production Environment : Request Access -> RESULT: Get new credentials and added to a group
- OIDC protected - Test environment : Request Access -> RESULT (auto): after approval, send credentials to Requestor
- OIDC protected - Prod environment : Request Access -> RESULT (manual): send credentials to Requestor
- OIDC protected with Claims

Application will be a Consumer.
The AccessRequest will hold a reference to the Credential (in keycloak or in kong).

For OIDC, a Claim can be added to the Token
For API Key and Basic Auth can be added to Kong

*/
import { strict as assert } from 'assert'

const {
  deleteRecord,
  deleteRecords,
  lookupApplication,
  lookupServices,
  lookupProductEnvironmentServices,
  lookupProductEnvironmentServicesBySlug,
  lookupEnvironmentAndApplicationByAccessRequest,
  lookupCredentialReferenceByServiceAccess,
  lookupKongConsumerIdByName,
  lookupCredentialIssuerById,
  linkCredRefsToServiceAccess,
  markActiveTheServiceAccess,
  addKongConsumer,
  addServiceAccess,
  linkServiceAccessToRequest,
} = require('../keystone');

import { registerClient, findClient } from './client-credentials'
import { registerApiKey } from './kong-api-key'

import {v4 as uuidv4} from 'uuid'

import { KeycloakClientRegistrationService, KeycloakTokenService, getOpenidFromDiscovery, getOpenidFromIssuer } from '../keycloak'

import { KongConsumerService } from '../kong'
import { FeederService } from '../feeder'

import { NewCredential, RequestControls } from './types'

import { IssuerEnvironmentConfig, getIssuerEnvironmentConfig } from './types'

//const Tasked = require('../tasked')

const isBlank = ((val:any) => val == null || typeof(val) == 'undefined' || val == "")


const { recordActivity } = require('../../lists/Activity')


const isRequested = (existingItem: any, updatedItem: any) => existingItem == null
const isUpdatingToApproved = (existingItem: any, updatedItem: any) => existingItem && (existingItem.isApproved == null || existingItem.isApproved == false) && updatedItem.isApproved
const isUpdatingToIssued = (existingItem: any, updatedItem: any) => existingItem && (existingItem.isIssued == null || existingItem.isIssued == false) && updatedItem.isIssued

const errors = {
    WF01: "WF01 Access Request Not Found",
    WF02: "WF02 Invalid Product Environment in Access Request",
    WF03: "WF03 Credential Issuer not specified in Product Environment",
    WF04: "WF04 --",
    WF05: "WF05 Invalid Credential Issuer in Product Environment",
    WF06: "WF06 Discovery URL invalid for Credential Issuer",
    WF07: "WF07 This service uses client credential flow, so an Application is required.",
    WF08: "WF08 Client Registration setting is missing from the Issuer",
    WF09: "WF09 Managed Client Registration requires a Client ID and Secret",
    WF10: "WF10 Initial Access Token is required when doing client registration via an IAT"
}

export const Validate = async (context: any, operation: any, existingItem: any, originalInput: any, resolvedData: any, addValidationError: any) => {
    try {
        const requestDetails = operation == 'create' ? null : await lookupEnvironmentAndApplicationByAccessRequest(context, existingItem.id)

        if (operation == 'create') {
            // If its create, make sure the App + ProductEnvironment doesn't already exist as a Request

        }
        if (isUpdatingToIssued(existingItem, resolvedData)) {
            assert.strictEqual(requestDetails != null, true, errors.WF01);
            assert.strictEqual(requestDetails.productEnvironment != null, true, errors.WF02);
    
            if (requestDetails.flow == 'client-credentials' || requestDetails.flow == 'authorization-code') {
                assert.strictEqual(requestDetails.productEnvironment.credentialIssuer != null, true, errors.WF03);

                // Find the credential issuer and based on its type, go do the appropriate action
                const issuer = await lookupCredentialIssuerById(context, requestDetails.productEnvironment.credentialIssuer.id)

                assert.strictEqual(issuer != null, true, errors.WF05);

                const issuerEnvConfig: IssuerEnvironmentConfig = getIssuerEnvironmentConfig(issuer, requestDetails.productEnvironment.name)
                
                if (issuer.mode == 'manual') {
                    throw Error('Manual credential issuing not supported yet!')
                }
                if (issuer.flow == 'client-credentials' && issuerEnvConfig.clientRegistration == 'anonymous') {
                    throw Error('Anonymous client registration not supported yet!')
                }
            
                if (issuer.flow == 'client-credentials') {
                    const clientRegistration = issuerEnvConfig.clientRegistration

                    //assert.strictEqual(issuer.oidcDiscoveryUrl != null && issuer.oidcDiscoveryUrl != "", true, errors.WF06);
                    const openid = await getOpenidFromIssuer(issuerEnvConfig.issuerUrl)
                    assert.strictEqual(openid != null, true, errors.WF06);

                    assert.strictEqual(['anonymous', 'managed', 'iat'].includes(clientRegistration), true, errors.WF08)
                    assert.strictEqual(clientRegistration == 'managed' && (isBlank(issuerEnvConfig.clientId) || isBlank(issuerEnvConfig.clientSecret)), false, errors.WF09)
                    assert.strictEqual(clientRegistration == 'iat' && isBlank(issuerEnvConfig.initialAccessToken), false, errors.WF10)
                } else if (issuer.flow == 'authorization-code') {
                    //assert.strictEqual(issuer.oidcDiscoveryUrl != null && issuer.oidcDiscoveryUrl != "", true, errors.WF06);
                    const openid = await getOpenidFromIssuer(issuerEnvConfig.issuerUrl)
                    assert.strictEqual(openid != null, true, errors.WF06);
                }

                // make sure the flow to valid based on whether an Application was specified or if its for the Requestor
                assert.strictEqual(issuer.flow == 'client-credentials' && requestDetails.application == null, false, errors.WF07);
            }
        }
    } catch (err) {
        console.log(err)
        assert(err instanceof assert.AssertionError);
        addValidationError(err.message)
    }
}

export const ValidateActiveEnvironment = async (context: any, operation: any, existingItem: any, originalInput: any, resolvedData: any, addValidationError: any) => {
    if (('active' in originalInput && originalInput['active'] == true) 
            || (operation == 'update' && 'active' in existingItem && existingItem['active'] == true) && !('active' in originalInput && originalInput['active'] == false)) {
        try {
            const envServices = existingItem == null ? null : await lookupProductEnvironmentServices(context, existingItem.id)

            const resolvedServices = ('services' in resolvedData) ? await lookupServices(context, resolvedData['services']) : null

            const flow = existingItem == null ? resolvedData['flow'] : envServices.flow

            // The Credential Issuer says what plugins are expected
            // Loop through the Services to make sure the plugin is configured correctly

            // for "kong-api-key-acl", make sure there is an 'acl' and 'key-auth' plugin on all Services of this environment
            // for "client-credentials", make sure there is an 'jwt-keycloak' plugin on all Services of this environment
            // for "authorization-code", make sure there is an 'oidc' plugin on all Services of this environment
            if (flow == 'kong-api-key-acl') {
                const isServiceMissingAllPlugins = (svc: any) => svc.plugins.filter((plugin:any) => ['acl', 'key-auth'].includes(plugin.name)).length != 2

                // If we are changing the service list, then use that to look for violations, otherwise use what is current
                const missing = resolvedServices ? resolvedServices.filter(isServiceMissingAllPlugins) : envServices.services.filter(isServiceMissingAllPlugins)

                if (missing.length != 0) {
                    addValidationError("[" + missing.map((s:any) => s.name).join(",") + "] missing or incomplete acl or key-auth plugin.")
                }
            } else if (flow == 'client-credentials') {
                const issuer = envServices.credentialIssuer
                const isServiceMissingAllPlugins = (svc:any) => svc.plugins.filter((plugin:any) => plugin.name == 'jwt-keycloak' && plugin.config['well_known_template'] == issuer.oidcDiscoveryUrl).length != 1

                // If we are changing the service list, then use that to look for violations, otherwise use what is current
                const missing = resolvedServices ? resolvedServices.filter(isServiceMissingAllPlugins) : envServices.services.filter(isServiceMissingAllPlugins)

                if (missing.length != 0) {
                    console.log(JSON.stringify(issuer, null, 5))
                    resolvedServices ? console.log("VALIDATION FAILURE(resolvedServices) " + JSON.stringify(resolvedServices, null, 5)) :
                    //console.log("VALIDATION FAILURE(envServices) " + JSON.stringify(envServices, null, 5)) 
                    addValidationError("[" + missing.map((s:any) => s.name).join(",") + "] missing or incomplete jwt-keycloak plugin.")
                }
            } else if (flow == 'authorization-code') {
                const issuer = envServices.credentialIssuer
                const isServiceMissingAllPlugins = (svc: any) => svc.plugins.filter((plugin:any) => plugin.name == 'oidc' && plugin.config['discovery'] == issuer.oidcDiscoveryUrl).length != 1

                // If we are changing the service list, then use that to look for violations, otherwise use what is current
                const missing = resolvedServices ? resolvedServices.filter(isServiceMissingAllPlugins) : envServices.services.filter(isServiceMissingAllPlugins)

                if (missing.length != 0) {
                    addValidationError("[" + missing.map((s:any) => s.name).join(",") + "] missing or incomplete oidc plugin.")
                }
            } else if (flow == 'public') {
            } else {
                addValidationError("Unexpected error when trying to validate the environment.")
            }

        } catch (err) {
            console.log(err)
            if(err instanceof assert.AssertionError) {
                addValidationError(err.message)
            } else {
                addValidationError('Unexpected error validating environment')
            }
        }
    }
}

const regenerateCredential = async (context: any, accessRequestId: string) : Promise<NewCredential> => {
    const feederApi = new FeederService(process.env.FEEDER_URL)

    const requestDetails = await lookupEnvironmentAndApplicationByAccessRequest(context, accessRequestId)

    const flow = requestDetails.productEnvironment.flow

    assert.strictEqual(['kong-api-key-acl', 'client-credentials'].includes(flow), true, 'invalid_flow')

    if (flow == 'kong-api-key-acl') {
        const productEnvironment = await lookupProductEnvironmentServices(context, requestDetails.productEnvironment.id)

        const application = await lookupApplication(context, requestDetails.application.id)

        //const extraIdentifier = uuidv4().replace(/-/g,'').toUpperCase().substr(0, 8)
        const clientId = application.appId + '-' + productEnvironment.appId

        const nickname = clientId

        const newApiKey = await registerApiKey (context, clientId, nickname) 

        console.log(JSON.stringify(newApiKey, null, 4))

        // Call /feeds to sync the Consumer with KeystoneJS
        await feederApi.forceSync('kong', 'consumer', newApiKey.consumer.id)

        const credentialReference = {
            keyAuthPK: newApiKey.apiKey.keyAuthPK
        }
        // Create a ServiceAccess record
        const consumerType = 'client'
        const aclEnabled = (productEnvironment.flow == 'kong-api-key-acl')
        const serviceAccessId = await addServiceAccess(context, clientId, false, aclEnabled, consumerType, credentialReference, null, newApiKey.consumerPK, productEnvironment, application )

        await linkServiceAccessToRequest (context, serviceAccessId, requestDetails.id)

        return {
            flow,
            apiKey: newApiKey.apiKey.apiKey
        } as NewCredential
    } else if (flow == 'client-credentials') {
        const productEnvironment = await lookupProductEnvironmentServices(context, requestDetails.productEnvironment.id)

        const application = await lookupApplication(context, requestDetails.application.id)

        //const extraIdentifier = uuidv4().replace(/-/g,'').toUpperCase().substr(0, 8)
        const clientId = application.appId + '-' + productEnvironment.appId

        const nickname = clientId

        const newClient = await registerClient (context, productEnvironment.name, productEnvironment.credentialIssuer.id, clientId)

        console.log(JSON.stringify(newClient, null, 4))

        const kongApi = new KongConsumerService(process.env.KONG_URL)
        const consumer = await kongApi.createKongConsumer (nickname, clientId)
        const consumerPK = await AddClientConsumer (context, nickname, clientId, consumer.id)

        const credentialReference = {
            id: newClient.client.id,
            clientId: newClient.client.clientId,
        }
        // Create a ServiceAccess record
        const consumerType = 'client'
        const aclEnabled = (productEnvironment.flow == 'kong-api-key-acl')
        const serviceAccessId = await addServiceAccess(context, clientId, false, aclEnabled, consumerType, credentialReference, null, consumerPK, productEnvironment, application )

        await linkServiceAccessToRequest (context, serviceAccessId, requestDetails.id)

        return {
            flow: productEnvironment.flow,
            clientId: newClient.client.clientId,
            clientSecret: newClient.client.clientSecret,
            tokenEndpoint: newClient.openid.token_endpoint
        } as NewCredential
    }
    return null
}

const AddClientConsumer = async (context: any, nickname: string, clientId: string, consumerKongId: string) : Promise<string> => {
    const feederApi = new FeederService(process.env.FEEDER_URL)
    const consumerPK = await addKongConsumer(context, nickname, clientId, consumerKongId)

    // Call /feeds to sync the Consumer with KeystoneJS
    await feederApi.forceSync('kong', 'consumer', consumerKongId)
    return consumerPK
}

export const CreateServiceAccount = async (context: any, productEnvironmentSlug: any, namespace: any, existingClientId?: string) : Promise<NewCredential> => {

    const productEnvironment = await lookupProductEnvironmentServicesBySlug(context, productEnvironmentSlug)

    const application : any = null
//    const application = await lookupApplication(context, requestDetails.application.id)

    const extraIdentifier = uuidv4().replace(/-/g,'').toUpperCase().substr(0, 12)
    const newClientId = ('sa-' + namespace + '-' + productEnvironment.appId + '-' + extraIdentifier).toLowerCase()

    const client = existingClientId != null ? 
        await findClient(context, productEnvironment.name, productEnvironment.credentialIssuer.id, existingClientId) : 
        await registerClient (context, productEnvironment.name, productEnvironment.credentialIssuer.id, newClientId)
    console.log(JSON.stringify(client, null, 4))

    const clientId = client.client.clientId
    const nickname = client.client.clientId

    const kongApi = new KongConsumerService(process.env.KONG_URL)
    const consumer = await kongApi.createKongConsumer (nickname, clientId)
    const consumerPK = await AddClientConsumer (context, nickname, clientId, consumer.id)

    const credentialReference = {
        id: client.client.id,
        clientId: client.client.clientId,
    }

    //await linkServiceAccessToRequest (context, serviceAccessId, requestDetails.id)

    const backToUser : NewCredential = {
        flow: productEnvironment.flow,
        clientId: client.client.clientId,
        clientSecret: client.client.clientSecret,
        tokenEndpoint: client.openid.token_endpoint
    }

    //updatedItem['credential'] = JSON.stringify(backToUser)
    console.log(JSON.stringify(backToUser, null, 4))    
    /*
        {
            "flow": "client-credentials",
            "clientId": "sa-abc-42da4f15-xxxx",
            "clientSecret": "xxxx",
            "tokenEndpoint": "https://auth/auth/realms/realm/protocol/openid-connect/token"
        }   
    */   

    // Create a ServiceAccess record
    const consumerType = 'client'
    const aclEnabled = (productEnvironment.flow == 'kong-api-key-acl')
    const serviceAccessId = await addServiceAccess(context, clientId, false, aclEnabled, consumerType, credentialReference, null, consumerPK, productEnvironment, application, namespace)

    //const clientId = requestDetails.serviceAccess.consumer.customId

    // Find the credential issuer and based on its type, go do the appropriate action
    const issuer = await lookupCredentialIssuerById(context, productEnvironment.credentialIssuer.id)

    const issuerEnvConfig: IssuerEnvironmentConfig = getIssuerEnvironmentConfig(issuer, productEnvironment.name)

    const openid = await getOpenidFromIssuer(issuerEnvConfig.issuerUrl)

    // token is NULL if 'iat'
    // token is retrieved from doing a /token login using the provided client ID and secret if 'managed'
    // issuer.initialAccessToken if 'iat'
    const token = issuerEnvConfig.clientRegistration == 'anonymous' ? null : (issuerEnvConfig.clientRegistration == 'managed' ? await new KeycloakTokenService(openid.issuer).getKeycloakSession(issuerEnvConfig.clientId, issuerEnvConfig.clientSecret) : issuerEnvConfig.initialAccessToken)

    const controls: RequestControls = JSON.parse('{"defaultClientScopes": []}')
    //const defaultClientScopes = controls.defaultClientScopes;
    
    const kcClientService = new KeycloakClientRegistrationService(openid.issuer, null)
    await kcClientService.updateClientRegistration (token, clientId, {clientId, enabled: true})

    // // https://dev.oidc.gov.bc.ca/auth/realms/xtmke7ky
    // console.log("S = "+openid.issuer.indexOf('/realms'))
    // const baseUrl = openid.issuer.substr(0, openid.issuer.indexOf('/realms'))
    // const realm = openid.issuer.substr(openid.issuer.lastIndexOf('/')+1)
    // console.log("B="+baseUrl+", R="+realm)

    // // Only valid for 'managed' client registration
    // const kcadminApi = new KeycloakClientService(baseUrl, realm)
    await kcClientService.login(issuerEnvConfig.clientId, issuerEnvConfig.clientSecret)

    // Sync Scopes
    await kcClientService.syncAndApply (clientId, controls.defaultClientScopes, [])

    await markActiveTheServiceAccess (context, serviceAccessId)    

    return backToUser
}



/**
 * When deleting a ServiceAccess record, also delete the related
 * - Kong Consumer
 * - Keycloak Client
 * - Access Request
 * keys : { application: "<id>", serviceAccess: "<id>"}
 * @param {*} context 
 */
export const DeleteAccess = async (context: any, operation: any, keys: any) => {
    const kongApi = new KongConsumerService(process.env.KONG_URL)

    // From the Application, get all the related ServiceAccesses
    // From these, call Kong and Keycloak to delete them
    if ('application' in keys) {
        const applicationId = keys.application

        /*
        */
        // const tasks = new Tasked(process.env.WORKING_PATH)
        // .add('AccessRequest', async (ctx, v) => { deleteRecords(context, 'AccessRequest', { application: { id: applicationId }}, true, ['id']) })
        // .add('task2', async (ctx, v) => { return { answer: ctx.task1.out}}, 'goodbye')
        // .add('task3', async () => true, 'hi')
        // await tasks.start()

        await deleteRecords(context, 'AccessRequest', { application: { id: applicationId }}, true, ['id'])
        .then((app: any) => deleteRecords(context, 'ServiceAccess', { application: { id: applicationId }}, true, ['id'])
            // .then((svc) => svc != null && deleteRecord(context, 'GatewayConsumer', { id: svc.consumer.id }, ['id'])
            //     .then((con) => svc != null && kongApi.deleteConsumer(svc.consumer.extForeignKey)
            //         .then((async () => {
            //             const issuer = await lookupCredentialIssuerById(context, svc.productEnvironment.credentialIssuer.id)
            //             const openid = await getOpenidFromDiscovery(issuer.oidcDiscoveryUrl)
            //             const token = issuer.clientRegistration == 'anonymous' ? null : (issuer.clientRegistration == 'managed' ? await new KeycloakTokenService(openid.issuer).getKeycloakSession(issuer.clientId, issuer.clientSecret) : issuer.initialAccessToken)
            //             // Need extra privilege to delete clients!
            //             return await new KeycloakClientService(null, null).deleteClientRegistration(openid.issuer, token, svc.consumer.customId)
            //         }))
            //     )
            // )
        )

    } else {
        const serviceAccessId = keys.serviceAccess

        assert.strictEqual(serviceAccessId != null && typeof(serviceAccessId) != "undefined", true)

        const svc = await lookupCredentialReferenceByServiceAccess (context, serviceAccessId)
        console.log(JSON.stringify(svc, null, 4))

        const flow = svc.productEnvironment.flow

        // const tasks = new Tasked(process.env.WORKING_PATH)
        // .add('AccessRequest', async (ctx, v) => { deleteRecords(context, 'AccessRequest', { application: { id: applicationId }}, true, ['id']) })

        await deleteRecord(context, 'AccessRequest', { serviceAccess: { id: serviceAccessId }}, ['id'])
        svc.consumer != null && deleteRecord(context, 'GatewayConsumer', { id: svc.consumer.id }, ['id', 'extForeignKey', 'customId'])

        svc.consumer != null && kongApi.deleteConsumer(svc.consumer.extForeignKey)
                .then((async () => {
                    if (flow == "client-credentials") {
                        const issuer = await lookupCredentialIssuerById(context, svc.productEnvironment.credentialIssuer.id)
                        const issuerEnvConfig: IssuerEnvironmentConfig = getIssuerEnvironmentConfig(issuer, svc.productEnvironment.name)
                        const openid = await getOpenidFromIssuer(issuerEnvConfig.issuerUrl)
                        const token = issuerEnvConfig.clientRegistration == 'anonymous' ? null : (issuerEnvConfig.clientRegistration == 'managed' ? await new KeycloakTokenService(openid.issuer).getKeycloakSession(issuerEnvConfig.clientId, issuerEnvConfig.clientSecret) : issuerEnvConfig.initialAccessToken)

                        // TODO
                        // Delete the Policies that are associated with the client!!
                        // Use the kcprotect service to find the UMA Policies that have this client ID
                        // and then delete each one


                        await new KeycloakClientRegistrationService(null, null).deleteClientRegistration(openid.issuer, token, svc.consumer.customId)
                    }
                }))
    }
}

export const Apply = async (context: any, operation: any, existingItem: any, originalInput: any, updatedItem: any) => {
    const kongApi = new KongConsumerService(process.env.KONG_URL)
    const feederApi = new FeederService(process.env.FEEDER_URL)

    const message = { text: "" }
    try {
        
        if (originalInput['credential'] == "NEW") {
            const newCredential = await regenerateCredential(context, existingItem['id'])
            if (newCredential != null) {
                updatedItem['credential'] = JSON.stringify(newCredential)
                message.text = "requested access"
            }
        }

        if (isUpdatingToIssued(existingItem, updatedItem)) {
            const requestDetails = await lookupEnvironmentAndApplicationByAccessRequest(context, existingItem.id)

            console.log(JSON.stringify(existingItem, null ,4))

            const flow = requestDetails.productEnvironment.flow
            const ns = requestDetails.productEnvironment.product.namespace
            const controls: RequestControls = 'controls' in requestDetails ? JSON.parse(requestDetails.controls) : {}
            const aclEnabled = (requestDetails.productEnvironment.flow == 'kong-api-key-acl')

            let kongConsumerPK : string;

            // If the authentication part hasn't been done, do it now
            if (requestDetails.serviceAccess == null) {
                assert.strictEqual(requestDetails.serviceAccess == null, false, 'Service Access is Missing!')


                // const appId = requestDetails.application == null ? null : requestDetails.application.appId

                // const clientRoles = 'clientRoles' in controls ? controls['clientRoles'] : [] // get them from the Product (Environment?)

                // const credentialReference = {}

                // const extraIdentifier = uuidv4().replace(/-/g,'').toUpperCase().substr(0, 8)
                // const clientId = appId + '-' + requestDetails.productEnvironment.appId
                // const consumerType = requestDetails.application == null ? 'user' : 'client'

                // const nickname = appId

                // var consumerPK = null
                // var kongConsumerPK = null

                // if (flow == 'client-credentials') {

                //     // Find the credential issuer and based on its type, go do the appropriate action
                //     const issuer = await lookupCredentialIssuerById(context, requestDetails.productEnvironment.credentialIssuer.id)

                //     const openid = await getOpenidFromDiscovery(issuer.oidcDiscoveryUrl)

                //     // token is NULL if 'iat'
                //     // token is retrieved from doing a /token login using the provided client ID and secret if 'managed'
                //     // issuer.initialAccessToken if 'iat'
                //     const token = issuer.clientRegistration == 'anonymous' ? null : (issuer.clientRegistration == 'managed' ? await new KeycloakTokenService(openid.issuer).getKeycloakSession( issuer.clientId, issuer.clientSecret) : issuer.initialAccessToken)

                //     // Find the Client ID for the ProductEnvironment - that will be used to associated the clientRoles

                //     // lookup Application and use the ID to make sure a corresponding Consumer exists (1 -- 1)
                //     const client = await clientRegistration(openid.issuer, token, clientId, uuidv4())
                //     assert.strictEqual(client.clientId, clientId)
                //     credentialReference['clientId'] = clientId
                //     credentialReference['registrationAccessToken'] = client.registrationAccessToken

                //     const consumer = await kongApi.createOrGetConsumer (nickname, clientId)
                //     consumerPK = await addKongConsumer(context, nickname, clientId, consumer.id)
                //     kongConsumerPK = consumer.id
                // } else if (flow == 'kong-api-key-acl') {
                //     // kong consumer could already exist - create if doesn't exist
                //     const consumer = await kongApi.createOrGetConsumer (nickname, clientId)
                //     const apiKey = await kongApi.addKeyAuthToConsumer (consumer.id)
                //     credentialReference['apiKey'] = require('crypto').createHash('sha1').update(apiKey.apiKey).digest('base64')
                //     credentialReference['keyAuthId'] = apiKey.keyAuthPK

                //     consumerPK = await addKongConsumer(context, nickname, clientId, consumer.id)
                //     kongConsumerPK = consumer.id
                // } else if (flow == 'authorization-code' && consumerType == 'user') {
                //     // lookup consumerPK and kongConsumerPK
                //     // they need to already exist or create (?)
                //     credentialReference = {}
                //     // acl could be enabled here
                    
                // } else {
                //     throw Error(`Flow ${flow} for ${consumerType} not supported at this time`)
                // }

                // // Create a ServiceAccess record
                // const serviceAccessName = appId + "." + extraIdentifier + "." + requestDetails.productEnvironment.name
                // const serviceAccessPK = await addServiceAccess(context, serviceAccessName, false, aclEnabled, consumerType, null, clientRoles, consumerPK, requestDetails.productEnvironment, requestDetails.application )

                // // Link new Credential to Access Request for reference and mark active
                // await linkCredRefsToServiceAccess(context, serviceAccessPK, credentialReference)

            } else {
                // get the KongConsumerPK 
                // kongConsumerPK 
                kongConsumerPK = requestDetails.serviceAccess.consumer.extForeignKey


                // update the clientRegistration to 'active'
                if (flow == 'client-credentials') {
                    const clientId = requestDetails.serviceAccess.consumer.customId

                    // Find the credential issuer and based on its type, go do the appropriate action
                    const issuer = await lookupCredentialIssuerById(context, requestDetails.productEnvironment.credentialIssuer.id)
                    const issuerEnvConfig: IssuerEnvironmentConfig = getIssuerEnvironmentConfig(issuer, requestDetails.productEnvironment.name)

                    const openid = await getOpenidFromIssuer(issuerEnvConfig.issuerUrl)

                    // token is NULL if 'iat'
                    // token is retrieved from doing a /token login using the provided client ID and secret if 'managed'
                    // issuer.initialAccessToken if 'iat'
                    const token = issuerEnvConfig.clientRegistration == 'anonymous' ? null : (issuerEnvConfig.clientRegistration == 'managed' ? await new KeycloakTokenService(openid.issuer).getKeycloakSession(issuerEnvConfig.clientId, issuerEnvConfig.clientSecret) : issuerEnvConfig.initialAccessToken)

                    const controls: RequestControls= JSON.parse(requestDetails.controls)
                    //const defaultClientScopes = controls.defaultClientScopes;
                    
                    const kcClientService = new KeycloakClientRegistrationService(openid.issuer, null)

                    await kcClientService.updateClientRegistration (token, clientId, {clientId, enabled: true})

                    // // https://dev.oidc.gov.bc.ca/auth/realms/xtmke7ky
                    // console.log("S = "+openid.issuer.indexOf('/realms'))
                    // const baseUrl = openid.issuer.substr(0, openid.issuer.indexOf('/realms'))
                    // const realm = openid.issuer.substr(openid.issuer.lastIndexOf('/')+1)
                    // console.log("B="+baseUrl+", R="+realm)

                    // Only valid for 'managed' client registration
                    // const kcadminApi = new KeycloakClientService(baseUrl, realm)
                    await kcClientService.login(issuerEnvConfig.clientId, issuerEnvConfig.clientSecret)
                    await kcClientService.syncAndApply (clientId, controls.defaultClientScopes, [])

                    await markActiveTheServiceAccess (context, requestDetails.serviceAccess.id)
                } else if (flow == 'kong-api-key-acl') {
                    // update the Consumer ACL group membership to requestDetails.productEnvironment.appId
                    await kongApi.updateConsumerACLByNamespace (kongConsumerPK, ns, [ requestDetails.productEnvironment.appId ], true)

                    await markActiveTheServiceAccess (context, requestDetails.serviceAccess.id)
                }
            }

            // Update the ACLs in Kong if they are enabled
            if (aclEnabled && 'aclGroups' in controls) {
                await kongApi.updateConsumerACLByNamespace(kongConsumerPK, ns, controls.aclGroups, true)
            }

            // Add the controls to the Consumer for Services/Routes that are part of the ProductEnvironment
            // request.controls:
            /*
                {
                    aclGroups: ['group1','group2'],
                    plugins: [
                        { name: "rate-limiting", service: { name: "abc" }, config: { "minutes": 100 } },
                        { name: "rate-limiting", route: { name: "def" }, config: { "minutes": 100 } }
                    ],
                    clientRoles: [
                        'Read', 'Write'
                    ]
                }
            */
            // Convert the service or route name to a extForeignKey
            if ('plugins' in controls) {
                for ( const plugin of controls.plugins) {
                    // assume the service and route IDs are Kong's unique IDs for them
                    await kongApi.addPluginToConsumer(kongConsumerPK, plugin)
                }
            }

            // Call /feeds to sync the Consumer with KeystoneJS
            await feederApi.forceSync('kong', 'consumer', kongConsumerPK)

            message.text = "approved access"
        }

        const refId = updatedItem.id
        const action = operation

        await recordActivity (context, action, 'AccessRequest', refId, message.text, "success", JSON.stringify(originalInput))
    } catch (err) {
        console.log("WORKFLOW ERR - "+err)
        await recordActivity (context, operation, 'AccessRequest', updatedItem.id, "Failed to Apply Workflow - " + err, "failed")
        .catch((e:any) => {console.log("Activity Recording Error " + e)})
        throw (err)
    }
}
