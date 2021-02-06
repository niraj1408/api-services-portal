const actionFilterNS = (context, value) => {
    const namespace = context['user']['namespace']
    if (process.env.RULE_DEBUG) { 
        console.log("Action: Filter By User NS" + namespace)
    }
    const _filter = { namespace: namespace }
    console.log("FILTER: " + JSON.stringify(_filter))
    return _filter
}

module.exports = actionFilterNS