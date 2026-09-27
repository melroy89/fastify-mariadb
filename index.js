'use strict'

const fp = require('fastify-plugin')
const mariadbPromise = require('mariadb')
const mariadbCallback = require('mariadb/callback')

const mode = Symbol('mariadb mode')

function fastifyMariadb (fastify, options, next) {
  const { type, name, promise: usePromise, connectionString, ...connectionOptions } = options
  const mariadb = usePromise ? mariadbPromise : mariadbCallback
  const config = connectionString || connectionOptions
  const isConnection = type === 'connection'
  const pendingClient = isConnection ? mariadb.createConnection(config) : mariadb.createPool(config)

  function onReady (err, client) {
    if (err) {
      if (client) closeClient(client, usePromise)
      return next(err)
    }

    const db = {
      [mode]: `${usePromise ? 'promise' : 'callback'}-${isConnection ? 'connection' : 'pool'}`,
      kind: `${usePromise ? 'promise' : 'callback'}-${isConnection ? 'connection' : 'pool'}`,
      [isConnection ? 'connection' : 'pool']: client,
      query: client.query.bind(client),
      execute: client.execute.bind(client),
      escape: client.escape.bind(client),
      escapeId: client.escapeId.bind(client),
      batch: client.batch.bind(client),
      importFile: client.importFile.bind(client)
    }
    if (isConnection) db.queryStream = client.queryStream.bind(client)
    else db.getConnection = client.getConnection.bind(client)

    if (name) {
      if (!fastify.mariadb) fastify.decorate('mariadb', Object.create(null))
      if (Object.hasOwn(fastify.mariadb, name)) {
        closeClient(client, usePromise)
        return next(new Error(`fastify-mariadb '${name}' instance name has already been registered`))
      }
      fastify.mariadb[name] = db
    } else {
      if (fastify.mariadb) {
        closeClient(client, usePromise)
        return next(new Error('fastify-mariadb has already been registered'))
      }
      fastify.decorate('mariadb', db)
    }

    fastify.addHook('onClose', (_fastify, done) => {
      if (usePromise) client.end().then(() => done(), done)
      else client.end(done)
    })
    next()
  }

  if (usePromise) {
    if (isConnection) {
      pendingClient.then(client => onReady(null, client), err => onReady(err))
    } else {
      pendingClient.query('SELECT 1').then(() => onReady(null, pendingClient), err => onReady(err, pendingClient))
    }
  } else if (isConnection) {
    pendingClient.connect(err => onReady(err, pendingClient))
  } else {
    pendingClient.query('SELECT 1', err => onReady(err, pendingClient))
  }
}

function closeClient (client, usePromise) {
  if (usePromise) client.end().catch(() => {})
  else client.end(() => {})
}

function isMariaDBPool (obj) {
  return obj?.[mode] === 'callback-pool'
}

function isMariaDBPromisePool (obj) {
  return obj?.[mode] === 'promise-pool'
}

function isMariaDBConnection (obj) {
  return obj?.[mode] === 'callback-connection'
}

function isMariaDBPromiseConnection (obj) {
  return obj?.[mode] === 'promise-connection'
}

module.exports = fp(fastifyMariadb, {
  fastify: '5.x',
  name: 'fastify-mariadb'
})
module.exports.default = fastifyMariadb
module.exports.fastifyMariadb = fastifyMariadb
module.exports.isMariaDBPool = isMariaDBPool
module.exports.isMariaDBPromisePool = isMariaDBPromisePool
module.exports.isMariaDBConnection = isMariaDBConnection
module.exports.isMariaDBPromiseConnection = isMariaDBPromiseConnection
