/*
  TODO:
    - work out how (and when) to validate the username and password fields
    - allow a validateUser() hook to be provided in config
*/
const express = require('express')
const session = require('express-session')

const jwt = require('express-jwt');
const jwksRsa = require('jwks-rsa');

class Oauth2ProxyAuthStrategy {
    constructor(keystone, listKey, config) {
      this.keystone = keystone;
      this.listKey = listKey;
      this._sessionManager = keystone._sessionManager;
      this._onAuthenticated = config.onAuthenticated || (() => {});

      this.gqlNames = {}; // Set by the auth provider
      this.config = {
        identityField: 'email',
        secretField: 'password',
        protectIdentities: true,
        ...config,
      };
    }
  
    getList() {
      return this.keystone.lists[this.listKey];
    }
  
    getInputFragment() {
      return `
        ${this.config.identityField}: String
        ${this.config.secretField}: String
      `;
    }
  
    prepareMiddleware(app) {
        app = express()
        app.set('trust proxy', true);

        const users = this.keystone.getListByKey('User')

        const jwtCheck = jwksRsa.expressJwtSecret({
            cache: true,
            rateLimit: true,
            jwksRequestsPerMinute: 5,
            jwksUri: process.env.JWKS_URL
        })
        
        const verifyJWT = jwt({ 
            secret: jwtCheck, 
            algorithms: ['RS256'], 
            credentialsRequired: false, 
            requestProperty: 'oauth_user', 
            getToken: (req) => ('x-forwarded-access-token' in req.headers) ? req.headers['x-forwarded-access-token'] : null
        })

        app.get('/admin/signin', verifyJWT, async (req, res, next) => {

            // The SessionManager is expecting an Authorization header, so give it one
            //req['headers']['authorization'] = 'Bearer ' + req.headers['x-forwarded-access-token']

            const name = req['oauth_user']['name']
            const email = req['oauth_user']['email']

            const username = req['oauth_user']['preferred_username']

            let results = await users.adapter.find({ ['email']: email })

            var operation = "update"

            if (results.length == 0) {
                console.log("EMAIL NOT FOUND - CREATING USER AUTOMATICALLY")
                const { errors } = await this.keystone.executeGraphQL({
                    context: this.keystone.createContext({ skipAccessControl: true }),
                    query: `mutation ($name: String, $email: String, $username: String) {
                            createUser(data: {name: $name, username: $username, email: $email, isAdmin: false}) {
                                id
                          
                        } }`,
                    variables: { name, email, username },
                });   
                results = await users.adapter.find({ ['email']: email })       
                operation = "create"      
            }

            const user = results[0]

            await this._authenticateItem(user, null, operation === 'create', req, res, next);
        })
        return app
    }

    async _authenticateItem(item, accessToken, isNewItem, req, res, next) {
        const token = await this._sessionManager.startAuthedSession(req, {
        item,
        list: this._getList(),
        });
        console.log("Created session " + JSON.stringify(req.session, null, 3))

        req.session.oauth_user = req.oauth_user
        
        this._onAuthenticated({ token, item, isNewItem }, req, res, next);
    }

    _getList() {
        return this.keystone.lists[this.listKey];
    }

    async _getItem(list, args, secretFieldInstance) {
      // Match by identity
      const { identityField } = this.config;
      const identity = args[identityField];
      const results = await list.adapter.find({ [identityField]: identity });
      // If we failed to match an identity and we're protecting existing identities then combat timing
      // attacks by creating an arbitrary hash (should take about as long has comparing an existing one)
      if (results.length !== 1 && this.config.protectIdentities) {
        // TODO: This should call `secretFieldInstance.compare()` to ensure it's
        // always consistent.
        // This may still leak if the workfactor for the password field has changed
        const hash = await secretFieldInstance.generateHash(
          'simulated-password-to-counter-timing-attack'
        );
        await secretFieldInstance.compare('', hash);
        return { success: false, message: '[passwordAuth:failure] Authentication failed' };
      }
  
      // Identity failures with helpful errors
      if (results.length === 0) {
        const key = '[passwordAuth:identity:notFound]';
        const message = `${key} The ${identityField} provided didn't identify any ${list.plural}`;
        return { success: false, message };
      }
      if (results.length > 1) {
        const key = '[passwordAuth:identity:multipleFound]';
        const message = `${key} The ${identityField} provided identified ${results.length} ${list.plural}`;
        return { success: false, message };
      }
      const item = results[0];
      return { success: true, item };
    }
  
    async _matchItem(item, args, secretFieldInstance) {
      const { secretField } = this.config;
      const secret = args[secretField];
      if (item[secretField]) {
        const success = await secretFieldInstance.compare(secret, item[secretField]);
        return {
          success,
          message: success
            ? 'Authentication successful'
            : `[passwordAuth:secret:mismatch] The ${secretField} provided is incorrect`,
        };
      }
  
      const hash = await secretFieldInstance.generateHash(
        'simulated-password-to-counter-timing-attack'
      );
      await secretFieldInstance.compare(secret, hash);
      return {
        success: false,
        message:
          '[passwordAuth:secret:notSet] The item identified has no secret set so can not be authenticated',
      };
    }
  
    getAdminMeta() {
      const { listKey, gqlNames } = this;
      const { identityField, secretField } = this.config;
      return { listKey, gqlNames, identityField, secretField };
    }
  }
  
  Oauth2ProxyAuthStrategy.authType = 'password';
  
  module.exports = { Oauth2ProxyAuthStrategy };