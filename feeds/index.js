const express = require('express')
const fetch = require('node-fetch')
const YAML = require('yaml')
const assert = require('assert').strict;
const app = express()
const port = 6000

assert.strictEqual('WORKING_PATH' in process.env, true, 'WORKING_PATH must be set')
assert.strictEqual('DESTINATION_URL' in process.env, true, 'DESTINATION_URL must be set')

const config = {
    kong: {
        destinationUrl: process.env.DESTINATION_URL,
        workingPath: process.env.WORKING_PATH + "/kong",
        url: process.env.KONG_ADMIN_URL
    },
    ckan: {
        destinationUrl: process.env.DESTINATION_URL,
        workingPath: process.env.WORKING_PATH + "/ckan",
        url: process.env.CKAN_URL
    },
    keycloak: {
        destinationUrl: process.env.DESTINATION_URL,
        workingPath: process.env.WORKING_PATH + "/keycloak",
        url: process.env.KC_URL,
        username: process.env.KC_USERNAME,
        password: process.env.KC_PASSWORD,
    },
    github: {
        destinationUrl: process.env.DESTINATION_URL,
        workingPath: process.env.WORKING_PATH + "/github",
        token: process.env.GITHUB_TOKEN
    },
    prometheus: {
        destinationUrl: process.env.DESTINATION_URL,
        workingPath: process.env.WORKING_PATH + "/prometheus",
        url: process.env.PROM_URL
    },
}

const sources = {
    kong: require('./kong'),
    ckan: require('./ckan'),
    prometheus: require('./prometheus')    
}

app.get('/health', (req, res) => {
  res.send('up')
})

// Schedule a periodic trigger of the sync and feed
app.get('/sync/:source/', (req, res) => {
    const source = req.params.source
    assert.strictEqual(source in sources, true, 'Invalid source ' + source)
    sources[source].sync(config[source])
    res.send({state:'processing'})
})

// List of entities

// Tell the feeder to resync the entity within the scope (i.e./ GatewayService for namespace xyz)
app.get('/hint/:entity/:scope', (req, res) => {

})

app.use((err, req, res, next) => {
    if (err) {
        console.error(err.stack)
        res.status(400).send({ error: "Oops.. there was a problem accepting this request!" })
    } else {
        next()
    }
})

const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}`)
})

process.on('SIGINT', () => server.close())