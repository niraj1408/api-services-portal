const { Text, Checkbox, Relationship } = require('@keystonejs/fields')
const { Markdown } = require('@keystonejs/fields-markdown')

const { byTracking, atTracking } = require('@keystonejs/list-plugins')

const { EnforcementPoint } = require('../authz/enforcement')

// Aidan (actor) approved (action) AccessRequest[erxAPIs for Bill #222-333-333] (type,name,refId) "Approved access request" (message)
module.exports = {
  fields: {
    type: {
        type: Text,
        isRequired: true,
    },
    name: {
        type: Text,
        isRequired: true,
    },
    action: {
        type: Text,
        isRequired: true,
    },
    message: {
        type: Markdown,
        isRequired: false,
    },
    refId: {
        type: Text,
        isRequired: true,
    },
    actor: { type: Relationship, ref: 'User' }
  },
  access: EnforcementPoint,
  plugins: [
    atTracking()
  ],
  recordActivity: (context, action, type, refId, message) => {
        console.log("Record Activity")
        const userId = context.authedItem.userId
        const name = `${action} ${type}[${refId}]`
        console.log("USERID="+userId+" NAME=" + name)

        return context.executeGraphQL({
            query: `mutation ($name: String, $type: String, $action: String, $refId: String, $message: String, $userId: String) {
                    createActivity(data: { type: $type, name: $name, action: $action, refId: $refId, message: $message, actor: { connect: { id : $userId }} }) {
                        id
                } }`,
            variables: { name, type, action, refId, message, userId },
        }).catch (err => {
            console.log("Activity : recording activity failed " + err)
        })
  }
}
