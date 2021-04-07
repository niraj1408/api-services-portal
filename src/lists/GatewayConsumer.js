const { Text, Checkbox, Relationship } = require('@keystonejs/fields')
const { Markdown } = require('@keystonejs/fields-markdown')

const { externallySourced } = require('../components/ExternalSource')

const { byTracking, atTracking } = require('@keystonejs/list-plugins')

const { EnforcementPoint } = require('../authz/enforcement')

const { lookupConsumerPlugins, lookupKongConsumerId } = require('../services/keystone')

const kong = require('../services/kong')
const feeder = require('../services/feeder')

module.exports = {
  fields: {
    username: {
        type: Text,
        isRequired: true,
        isUnique: true,
        adminConfig: {
            isReadOnly: true
        }
    },
    customId: {
        type: Text,
        isRequired: false,
        adminConfig: {
            isReadOnly: true
        }
    },
    // kongConsumerId: {
    //     type: Text,
    //     isRequired: false,
    //     adminConfig: {
    //         isReadOnly: true
    //     }
    // },
    aclGroups: {
        type: Text,
        isRequired: false,
        adminConfig: {
            isReadOnly: true
        }
    },
    namespace: {
        type: Text,
        isRequired: false,
        adminConfig: {
            isReadOnly: true
        }
    },
    tags: {
        type: Text,
        isRequired: false,
        adminConfig: {
            isReadOnly: true
        }
    },
    plugins: { type: Relationship, ref: 'GatewayPlugin', many: true }
  },
  access: EnforcementPoint,
  plugins: [
    externallySourced(),
    atTracking()
  ],

  extensions: [
      (keystone) => {
        keystone.extendGraphQLSchema({
            queries: [
              {
                schema: 'getGatewayConsumerPlugins(id: ID!): GatewayConsumer',
                resolver: async (item, args, context, info, { query, access }) => {
                    const noauthContext =  keystone.createContext({ skipAccessControl: true })

                    return await lookupConsumerPlugins (noauthContext, args.id )
                },
                access: EnforcementPoint,
              },
            ],
            mutations: [
              {
                schema: 'createGatewayConsumerPlugin(id: ID!, plugin: String!): GatewayConsumer',
                resolver: async (item, args, context, info, { query, access }) => {
                    const noauthContext =  keystone.createContext({ skipAccessControl: true })

                    const kongApi = new kong(process.env.KONG_URL)
                    const feederApi = new feeder(process.env.FEEDER_URL)

                    const kongConsumerPK = await lookupKongConsumerId (context, args.id)
                    
                    const result = await kongApi.addPluginToConsumer (kongConsumerPK, JSON.parse(args.plugin) )

                    await feederApi.forceSync('kong', 'consumer', kongConsumerPK)
                    return result
                },
                access: EnforcementPoint,
              },
              {
                schema: 'updateGatewayConsumerPlugin(id: ID!, pluginPK: ID!, plugin: String!): GatewayConsumer',
                resolver: async (item, args, context, info, { query, access }) => {
                    const noauthContext =  keystone.createContext({ skipAccessControl: true })

                    const kongApi = new kong(process.env.KONG_URL)
                    const feederApi = new feeder(process.env.FEEDER_URL)

                    const kongConsumerPK = await lookupKongConsumerId (context, args.id)
                    
                    const result = await kongApi.updateConsumerPlugin (kongConsumerPK, pluginPK, JSON.parse(args.plugin) )

                    await feederApi.forceSync('kong', 'consumer', kongConsumerPK)
                    return result
                },
                access: EnforcementPoint,
              }
            ]
          });
      }
  ]

}
