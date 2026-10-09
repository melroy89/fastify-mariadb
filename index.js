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
  let cancelled = false
  let cleanup
  let clientPromise

  // Install lifecycle handlers before acquiring a client. Promise connections can
  // arrive after boot has failed; shutdown must also await and close those clients.
  fastify.addHook('onClose', () => close())
  function close () {
    cancelled = true
    cleanup ||= clientPromise.then(client => usePromise
      ? client.end()
      : new Promise((resolve, reject) => client.end(err => err ? reject(err) : resolve())), () => {})
    return cleanup
  }

  // A separate initialization step lets after() observe its timeout without
  // calling ready() during registration, which would stall await register().
  fastify.register(fp(function initializeMariaDB (_fastify, _options, done) {
    clientPromise = Promise.resolve().then(() => isConnection
      ? mariadb.createConnection(config)
      : mariadb.createPool(config))

    clientPromise.then(async client => {
      if (isConnection) {
        if (!usePromise) await new Promise((resolve, reject) => client.connect(err => err ? reject(err) : resolve()))
      } else if (usePromise) {
        await client.query('SELECT 1')
      } else {
        await new Promise((resolve, reject) => client.query('SELECT 1', err => err ? reject(err) : resolve()))
      }
      if (cancelled) return

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
        if (!Object.hasOwn(fastify, 'mariadb')) {
          fastify.decorate('mariadb', Object.assign(Object.create(null), fastify.mariadb))
        }
        if (Object.hasOwn(fastify.mariadb, name)) {
          throw new Error(`fastify-mariadb '${name}' instance name has already been registered`)
        }
        Object.defineProperty(fastify.mariadb, name, { value: db, enumerable: true, configurable: true, writable: true })
      } else {
        if (fastify.mariadb) {
          throw new Error('fastify-mariadb has already been registered')
        }
        fastify.decorate('mariadb', db)
      }

      done()
    }).catch(async err => {
      const notify = !cancelled
      await close().catch(() => {})
      if (notify) done(err)
    })
  }))
  fastify.after((err, done) => {
    if (err) close().catch(() => {})
    done(err)
  })
  next()
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
