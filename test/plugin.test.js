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
