'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const plugin = require('../index')

const config = {
  host: process.env.MARIADB_HOST || '127.0.0.1',
  port: Number(process.env.MARIADB_PORT || 3306),
  user: process.env.MARIADB_USER || 'root',
  password: process.env.MARIADB_PASSWORD || '',
  database: process.env.MARIADB_DATABASE || 'test'
}

const modes = [
  { promise: false, type: 'pool', guard: 'isMariaDBPool' },
  { promise: true, type: 'pool', guard: 'isMariaDBPromisePool' },
  { promise: false, type: 'connection', guard: 'isMariaDBConnection' },
  { promise: true, type: 'connection', guard: 'isMariaDBPromiseConnection' }
]

function callback (run) {
  return new Promise((resolve, reject) => run((err, result, metadata) => err ? reject(err) : resolve({ result, metadata })))
}

for (const mode of modes) {
  test(`${mode.promise ? 'promise' : 'callback'} ${mode.type}`, async (t) => {
    const app = Fastify()
    t.after(() => app.close())
    app.register(plugin, { ...config, promise: mode.promise, type: mode.type })
    await app.ready()
    const db = app.mariadb
    for (const candidate of modes) {
      t.assert.strictEqual(plugin[candidate.guard](db), candidate === mode)
    }
    t.assert.strictEqual(db.kind, `${mode.promise ? 'promise' : 'callback'}-${mode.type}`)
    t.assert.strictEqual(typeof db.format, 'undefined')
    t.assert.strictEqual(db.escape("o'brien"), "'o\\'brien'")
    t.assert.strictEqual(db.escapeId('table.name'), '`table.name`')

    const query = mode.promise
      ? await db.query('SELECT ? AS value', [7])
      : (await callback(done => db.query('SELECT ? AS value', [7], done))).result
    t.assert.strictEqual(query[0].value, 7)

    const execute = mode.promise
      ? await db.execute('SELECT ? AS value', [8])
      : (await callback(done => db.execute('SELECT ? AS value', [8], done))).result
    t.assert.strictEqual(execute[0].value, 8)

    if (mode.promise && mode.type === 'pool') {
      // A temporary table belongs to one connection, so use a dedicated connection for batching.
      const batchConnection = await db.getConnection()
      try {
        await batchConnection.query('CREATE TEMPORARY TABLE fastify_mariadb_batch (value INT)')
        await batchConnection.batch('INSERT INTO fastify_mariadb_batch (value) VALUES (?)', [[1], [2]])
        const rows = await batchConnection.query('SELECT value FROM fastify_mariadb_batch ORDER BY value')
        t.assert.deepStrictEqual(rows.map(row => row.value), [1, 2])
      } finally {
        await batchConnection.release()
      }
    }

    if (mode.type === 'pool') {
      const connection = mode.promise
        ? await db.getConnection()
        : (await callback(done => db.getConnection(done))).result
      t.assert.ok(connection)
      if (mode.promise) await connection.release()
      else await callback(done => connection.release(done))
    } else {
      t.assert.strictEqual(typeof db.queryStream, 'function')
      const stream = db.queryStream('SELECT 1 AS value UNION ALL SELECT 2 AS value')
      const values = []
      for await (const row of stream) values.push(row.value)
      t.assert.deepStrictEqual(values, [1, 2])
    }
  })
}

test('named instances and duplicate registration', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(plugin, { ...config, name: 'first', promise: true })
  app.register(plugin, { ...config, name: 'second', promise: true })
  await app.ready()
  t.assert.ok(app.mariadb.first)
  t.assert.ok(app.mariadb.second)
})

test('named instances can use inherited object property names', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  for (const name of ['toString', 'constructor', '__proto__']) {
    app.register(plugin, { ...config, name, promise: true })
  }
  await app.ready()
  for (const name of ['toString', 'constructor', '__proto__']) {
    const rows = await app.mariadb[name].query('SELECT 1 AS value')
    t.assert.strictEqual(rows[0].value, 1)
  }
})

test('duplicate name fails', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(plugin, { ...config, name: 'same', promise: true })
  app.register(plugin, { ...config, name: 'same', promise: true })
  await t.assert.rejects(app.ready(), /fastify-mariadb 'same' instance name has already been registered/)
})

test('connection failure reaches Fastify', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(plugin, { ...config, port: 6000, promise: true, type: 'connection' })
  await t.assert.rejects(app.ready(), /ECONNREFUSED/)
})

test('duplicate unnamed registration fails', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(plugin, { ...config })
  app.register(plugin, { ...config })
  await t.assert.rejects(app.ready(), /fastify-mariadb has already been registered/)
})

test('callback connection failure reaches Fastify', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(plugin, { ...config, port: 6000, type: 'connection' })
  await t.assert.rejects(app.ready(), /ECONNREFUSED/)
})

test('connection URI and metadata option', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  const uri = `mariadb://${config.user}@${config.host}:${config.port}/${config.database}`
  app.register(plugin, { connectionString: uri, promise: true })
  await app.ready()
  const [rows, metadata] = await app.mariadb.query({ sql: 'SELECT 1 AS value', metaAsArray: true })
  t.assert.strictEqual(rows[0].value, 1)
  t.assert.strictEqual(metadata[0].name(), 'value')
})

test('SQL file import through connector', async (t) => {
  const { mkdtemp, writeFile, rm } = require('node:fs/promises')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'fastify-mariadb-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'import.sql')
  await writeFile(file, 'CREATE TABLE fastify_mariadb_import (value INT);\nINSERT INTO fastify_mariadb_import VALUES (42);\n')
  const app = Fastify()
  t.after(() => app.close())
  app.register(plugin, { ...config, promise: true, type: 'connection' })
  await app.ready()
  await app.mariadb.query('DROP TABLE IF EXISTS fastify_mariadb_import')
  try {
    await app.mariadb.importFile({ file })
    const rows = await app.mariadb.query('SELECT value FROM fastify_mariadb_import')
    t.assert.strictEqual(rows[0].value, 42)
  } finally {
    await app.mariadb.query('DROP TABLE IF EXISTS fastify_mariadb_import')
  }
})

test('pool connection failure reaches Fastify', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(plugin, { ...config, port: 6000, acquireTimeout: 1000, promise: true })
  await t.assert.rejects(app.ready(), /failed to retrieve a connection from pool/)
})

test('connector options and readable insert values pass through', async (t) => {
  const { Readable } = require('node:stream')
  const app = Fastify()
  t.after(() => app.close())
  app.register(plugin, { ...config, promise: true, type: 'connection', pipelining: true, rowsAsArray: true })
  await app.ready()
  await app.mariadb.query('CREATE TEMPORARY TABLE fastify_mariadb_stream (value TEXT)')
  await app.mariadb.query('INSERT INTO fastify_mariadb_stream VALUES (?)', [Readable.from([Buffer.from('streamed')])])
  const first = app.mariadb.query('SELECT value FROM fastify_mariadb_stream')
  const second = app.mariadb.query('SELECT 2 AS value')
  t.assert.deepStrictEqual((await first)[0], ['streamed'])
  t.assert.deepStrictEqual((await second)[0], [2])
})

for (const unnamed of [false, true]) {
  test(`named clients stay in their scope with ${unnamed ? 'an unnamed' : 'a named'} parent client`, async t => {
    const app = Fastify()
    t.after(() => app.close())
    app.register(plugin, { ...config, promise: true, ...(unnamed ? {} : { name: 'parent' }) })
    let first, second, descendant
    app.register(async scope => {
      first = scope
      scope.register(plugin, { ...config, promise: true, name: 'local' })
      scope.register(async child => {
        descendant = child
        child.register(plugin, { ...config, promise: true, name: 'nested' })
      })
    })
    app.register(async scope => {
      second = scope
      scope.register(plugin, { ...config, promise: true, name: 'local' })
    })
    await app.ready()
    t.assert.strictEqual(app.mariadb.local, undefined)
    t.assert.strictEqual(first.mariadb.nested, undefined)
    t.assert.strictEqual(second.mariadb.nested, undefined)
    t.assert.notStrictEqual(first.mariadb.local, second.mariadb.local)
    t.assert.strictEqual(descendant.mariadb.local, first.mariadb.local)
    t.assert.strictEqual(Object.getPrototypeOf(first.mariadb), null)
    const inherited = unnamed ? first.mariadb : first.mariadb.parent
    const original = unnamed ? app.mariadb : app.mariadb.parent
    t.assert.ok(plugin.isMariaDBPromisePool(inherited))
    t.assert.strictEqual(inherited.pool, original.pool)
    t.assert.strictEqual((await inherited.query('SELECT 42 AS value'))[0].value, 42)
    const end = original.pool.end.bind(original.pool)
    let closes = 0
    t.mock.method(original.pool, 'end', () => { closes++; return end() })
    await app.close()
    t.assert.strictEqual(closes, 1)
  })

  for (const name of ['__proto__', 'constructor', 'toString']) {
    test(`${name} is safe and rejects duplicates ${unnamed ? 'after an unnamed client' : 'in a named registry'}`, async t => {
      const app = Fastify()
      t.after(() => app.close())
      let prototype
      if (unnamed) app.register(plugin, { ...config, promise: true })
      app.register(plugin, { ...config, promise: true, name })
      app.after(() => {
        prototype = Object.getPrototypeOf(app.mariadb)
        t.assert.strictEqual(prototype, unnamed ? Object.prototype : null)
        t.assert.ok(Object.hasOwn(app.mariadb, name))
        t.assert.ok(plugin.isMariaDBPromisePool(app.mariadb[name]))
      })
      app.register(plugin, { ...config, promise: true, name })
      await t.assert.rejects(app.ready(), new RegExp(`'${name}' instance name has already been registered`))
      t.assert.strictEqual(Object.getPrototypeOf(app.mariadb), prototype)
    })
  }
}

test('a child cannot replace an inherited named client', async t => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(plugin, { ...config, promise: true, name: 'parent' })
  app.register(async scope => {
    scope.register(plugin, { ...config, promise: true, name: 'parent' })
  })
  await t.assert.rejects(app.ready(), /'parent' instance name has already been registered/)
})

for (const name of ['query', 'pool', 'kind']) {
  test(`a named client cannot replace the default client's ${name}`, async t => {
    const app = Fastify()
    t.after(() => app.close())
    app.register(plugin, { ...config, promise: true })
    app.register(plugin, { ...config, promise: true, name })
    await t.assert.rejects(app.ready(), new RegExp(`'${name}' instance name has already been registered`))
  })
}
