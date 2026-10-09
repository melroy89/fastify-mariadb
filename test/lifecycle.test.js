'use strict'

const { test } = require('node:test')
const { once } = require('node:events')
const net = require('node:net')
const { setImmediate } = require('node:timers/promises')
const Fastify = require('fastify')
const plugin = require('../index')

const config = {
  host: process.env.MARIADB_HOST || '127.0.0.1',
  port: Number(process.env.MARIADB_PORT || 3306),
  user: process.env.MARIADB_USER || 'root',
  password: process.env.MARIADB_PASSWORD || '',
  database: process.env.MARIADB_DATABASE || 'test',
  connectionLimit: 1
}

// Hold the real server handshake until the test explicitly allows it through.
async function delayedDatabase (t) {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const sockets = new Set()
  let connected
  const proxy = net.createServer(client => {
    const upstream = net.connect(config.port, config.host)
    const closed = [client, upstream].map(socket => {
      sockets.add(socket)
      socket.on('error', () => {})
      return new Promise(resolve => socket.once('close', () => {
        sockets.delete(socket)
        resolve()
      }))
    })
    client.on('close', () => upstream.destroy())
    upstream.on('close', () => client.destroy())
    gate.then(() => client.pipe(upstream).pipe(client))
    connected(Promise.all(closed))
  })
  // Do not assimilate the close promise: the caller first waits for acceptance.
  const connection = new Promise(resolve => {
    connected = closed => resolve({ closed })
  })
  t.after(async () => {
    release()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => proxy.close(resolve))
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  return { port: proxy.address().port, release, connection }
}

for (const promise of [false, true]) {
  for (const type of ['pool', 'connection']) {
    for (const closeFirst of [false, true]) {
      test(`${promise ? 'promise' : 'callback'} ${type}: late startup, close ${closeFirst ? 'before' : 'after'} handshake`, { timeout: 10000 }, async t => {
        const proxy = await delayedDatabase(t)
        const app = Fastify({ pluginTimeout: 300 })
        t.after(() => app.close())
        app.register(plugin, { ...config, host: '127.0.0.1', port: proxy.port, promise, type, connectTimeout: 3000, acquireTimeout: 3000 })
        const startup = closeFirst ? app.listen({ port: 0, host: '127.0.0.1' }) : app.ready()
        const ready = t.assert.rejects(startup, { code: 'FST_ERR_PLUGIN_TIMEOUT' })
        const { closed } = await proxy.connection
        await ready
        let closing
        if (closeFirst) {
          let finished = false
          closing = app.close().then(() => { finished = true })
          await setImmediate()
          if (promise && type === 'connection') t.assert.strictEqual(finished, false)
        }
        proxy.release()
        await closed
        await (closing || app.close())
        t.assert.strictEqual(app.hasDecorator('mariadb'), false)
      })
    }
  }
}

for (const promise of [false, true]) {
  test(`${promise ? 'promise' : 'callback'} pool shutdown error is reported and end is called once`, async t => {
    const app = Fastify()
    app.register(plugin, { ...config, promise })
    await app.ready()
    const pool = app.mariadb.pool
    const end = pool.end.bind(pool)
    const error = new Error('shutdown failed')
    let calls = 0
    t.mock.method(pool, 'end', callback => {
      calls++
      if (promise) return end().then(() => { throw error })
      end(() => callback(error))
    })
    await t.assert.rejects(app.close(), error)
    await app.close()
    t.assert.strictEqual(calls, 1)
  })

  test(`${promise ? 'promise' : 'callback'} invalid configuration fails without leaking a client`, async t => {
    const app = Fastify()
    t.after(() => app.close())
    app.register(plugin, { promise, connectionString: 'not a valid URI' })
    await t.assert.rejects(app.ready())
    t.assert.strictEqual(app.hasDecorator('mariadb'), false)
  })
}

for (const promise of [false, true]) {
  test(`${promise ? 'promise' : 'callback'} decoration failure preserves the startup error when cleanup fails`, async t => {
    const app = Fastify()
    const startupError = new Error('decoration failed')
    const cleanupError = new Error('cleanup failed')
    let closes = 0
    t.mock.method(app, 'decorate', (name, db) => {
      const end = db.pool.end.bind(db.pool)
      t.mock.method(db.pool, 'end', callback => {
        closes++
        if (promise) return end().then(() => { throw cleanupError })
        end(() => callback(cleanupError))
      })
      throw startupError
    })
    app.register(plugin, { ...config, promise })
    await t.assert.rejects(app.ready(), startupError)
    await t.assert.rejects(app.close(), cleanupError)
    t.assert.strictEqual(closes, 1)
    t.assert.strictEqual(app.hasDecorator('mariadb'), false)
  })
}

for (const promise of [false, true]) {
  test(`${promise ? 'promise' : 'callback'} awaited registration allows subsequent plugins and routes`, { timeout: 5000 }, async t => {
    const app = Fastify()
    t.after(() => app.close())
    await app.register(plugin, { ...config, promise })
    await app.register(async scope => {
      await scope.register(plugin, { ...config, promise, name: 'child' })
      scope.get('/child', async () => ({ kind: scope.mariadb.child.kind }))
    })
    app.get('/root', async () => ({ kind: app.mariadb.kind }))
    t.assert.strictEqual((await app.inject('/root')).statusCode, 200)
    t.assert.strictEqual((await app.inject('/child')).statusCode, 200)
  })
}
