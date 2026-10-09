# @melroy89/fastify-mariadb

[![CI](https://github.com/melroy89/fastify-mariadb/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/melroy89/fastify-mariadb/actions/workflows/ci.yml)
[![NPM version](https://img.shields.io/npm/v/%40melroy89%2Ffastify-mariadb.svg?style=flat)](https://www.npmjs.com/package/@melroy89/fastify-mariadb)

Fastify plugin for the official [MariaDB Connector/Node.js](https://github.com/mariadb-corporation/mariadb-connector-nodejs). It shares a pool or connection through `fastify.mariadb` and closes it when Fastify closes.

The public npm package is [@melroy89/fastify-mariadb](https://www.npmjs.com/package/@melroy89/fastify-mariadb).

## Install

```sh
npm install @melroy89/fastify-mariadb
```

This version supports Fastify 5 and requires Node.js 20 or newer, as required by the MariaDB connector.
The test suite runs against MariaDB 13.0.2 (rolling) and 12.3.3 (LTS).

## Promise API

Set `promise: true` to use the connector's promise API.

```js
const fastify = require('fastify')()

fastify.register(require('@melroy89/fastify-mariadb'), {
  promise: true,
  host: 'localhost',
  user: 'root',
  database: 'app',
  connectionLimit: 10
})

fastify.get('/users/:id', async request => {
  const rows = await fastify.mariadb.query(
    'SELECT id, name FROM users WHERE id = ?',
    [request.params.id]
  )
  return rows[0]
})
```

Queries return rows directly; writes return a result object. Set `metaAsArray: true` to receive `[rows, metadata]`.

### Transactions

With `promise: true`, use one borrowed connection to create an order and its item together. This example assumes existing `orders` and `order_items` tables using InnoDB:

```js
async function createOrder (customerId, productId, quantity) {
  const connection = await fastify.mariadb.getConnection()
  try {
    await connection.beginTransaction()
    const order = await connection.query(
      'INSERT INTO orders (customer_id) VALUES (?)', [customerId]
    )
    await connection.query(
      'INSERT INTO order_items (order_id, product_id, quantity) VALUES (?, ?, ?)',
      [order.insertId, productId, quantity]
    )
    await connection.commit()
    return order.insertId
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    await connection.release() // Always release in finally block
  }
}
```

## Callback API

The default is the connector's callback API. Query callbacks receive `(error, rows, metadata)`.

```js
const fastify = require('fastify')()

fastify.register(require('@melroy89/fastify-mariadb'), {
  host: 'localhost',
  user: 'root',
  database: 'app'
})

fastify.ready(error => {
  if (error) throw error
  fastify.mariadb.query('SELECT ? AS value', [1], (error, rows, metadata) => {
    if (error) throw error
    console.log(rows[0].value, metadata)
  })
})
```

Callback pool connections are returned with `getConnection(callback)` and should be released with `connection.release(callback)`.

## Options and available methods

The plugin accepts MariaDB connector pool and connection options, plus:

| Option | Meaning |
| --- | --- |
| `promise` | Use the promise API; defaults to the callback API. |
| `type` | `pool` (default) or `connection`. |
| `name` | Store a named instance at `fastify.mariadb[name]`. |
| `connectionString` | Pass a MariaDB connection URI instead of the other connection options. |

`fastify.mariadb` exposes `query`, `execute`, `batch`, `importFile`, `escape`, and `escapeId`.

- Pool mode adds `pool` and `getConnection`.
- Connection mode adds `connection` and `queryStream`.
- Additional methods are available on the underlying connector instance.

Use query placeholders; the plugin has no `format` helper.

### Pool options

Pooling is the default. Connector options passed to `register` are forwarded to `mariadb.createPool()`:

```js
const fastify = require('fastify')()

fastify.register(require('@melroy89/fastify-mariadb'), {
  promise: true,
  host: 'localhost',
  user: 'app',
  password: 'your-password',
  database: 'app',
  connectionLimit: 10
})

fastify.get('/health/db', async () => {
  return fastify.mariadb.query('SELECT 1 AS ok')
})
```

### Connection URI

The plugin's `connectionString` option passes a URI directly to `mariadb.createPool()` in pool mode. Include pool options in the URI's query string:

```js
fastify.register(require('@melroy89/fastify-mariadb'), {
  promise: true,
  connectionString: 'mariadb://app:your-password@localhost:3306/app' +
    '?connectionLimit=10&connectTimeout=1000&acquireTimeout=5000' +
    '&queryTimeout=10000&socketTimeout=30000' +
    '&idleTimeout=60&leakDetectionTimeout=30000'
})
```

| URI option | Example setting |
| --- | --- |
| `connectionLimit` | At most 10 connections. |
| `connectTimeout` | 1 second to establish a connection. |
| `acquireTimeout` | 5 seconds to obtain a pool connection. |
| `queryTimeout` | 10 seconds per query. |
| `socketTimeout` | Close a socket after 30 seconds without activity. |
| `idleTimeout` | Idle pool connection timeout of 60 seconds. Keep below the server's `wait_timeout`. |
| `leakDetectionTimeout` | Log a possible leak when a connection is borrowed for over 30 seconds. |

Timeout values are milliseconds, except `idleTimeout`, which uses seconds. These are example values; adjust them for your workload.

- `connectionString` replaces separate connector options.
- Use `encodeURIComponent()` for special characters in URI usernames and passwords.

Full options and defaults: [connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options) · [pool options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api#createpool-options-pool).

## Benchmark

A sequential, parameterized three-table join ran against the same seeded data (400 customers, 4,000 orders, and 12,000 order items). Each value is the median of five rounds of 200 queries after warmup on one host. The comparison includes each plugin's connector and its own LTS database server. Lower latency is better; the difference is relative to the MySQL stack.

| API mode | `@fastify/mysql` + MySQL 9.7.2 | `@melroy89/fastify-mariadb` + MariaDB 12.3.3 | Difference |
| --- | ---: | ---: | ---: |
| Promise pool | 1.3036 ms | 1.0639 ms | -18.4% |
| Promise connection | 1.2843 ms | 1.0529 ms | -18.0% |
| Callback pool | 1.2775 ms | 1.0851 ms | -15.1% |
| Callback connection | 1.2975 ms | 1.0477 ms | -19.3% |

## Connector features

The plugin uses the official connector directly. Its features are available through the exposed methods, the underlying `pool` or `connection`, or connector options passed to `register`:

| Feature | How to use it |
| --- | --- |
| Pooling and prepared statements | Use `query`, `execute`, or `getConnection` on `fastify.mariadb`. |
| Bulk operations | Use `batch` with multiple parameter sets. |
| Insert streaming | Pass a readable stream as a query value. |
| Row streaming | Use `queryStream` in connection mode, or on a connection obtained from a pool. |
| SQL file import | Use `importFile({ file })`; `database` is optional. |
| Pipelining | Pass `pipelining: true` in the registration options. |
| TLS and server authentication | Pass connector TLS options such as `ssl: true`; the connector handles the server's authentication plugin, including ed25519 when configured by the server. |
| Query metadata and diagnostics | Use `metaAsArray`, `rowsAsArray`, and `trace` connector options as needed. |

MariaDB's metadata optimization, pool behavior, and performance characteristics belong to the connector and server. The plugin adds no separate switches for them and makes no performance guarantee.

The examples below use `promise: true` and pool mode unless stated otherwise.
Run them after `await fastify.ready()`, inside an async function or using top-level `await` in an ES module.

For bulk writes, `batch` uses the connector's bulk operation support:

```js
await fastify.mariadb.batch(
  'INSERT INTO users (name) VALUES (?)',
  [['Ada'], ['Grace']]
)
```

The connector also accepts a readable stream as a query value. Supply Buffer chunks when streaming binary or text data:

```js
const { Readable } = require('node:stream')

await fastify.mariadb.query(
  'INSERT INTO documents (body) VALUES (?)',
  [Readable.from([Buffer.from('content')])]
)
```

For large result sets in connection mode, use `queryStream` and close the stream if processing stops early:

```js
const stream = fastify.mariadb.queryStream('SELECT * FROM users')
try {
  for await (const row of stream) console.log(row)
} finally {
  stream.close()
}
```

In pool mode, call `queryStream` on a borrowed connection and release it after the stream finishes:

```js
const connection = await fastify.mariadb.getConnection()
const stream = connection.queryStream('SELECT * FROM users')
try {
  for await (const row of stream) {
    console.log(row)
  }
} finally {
  stream.close()
  await connection.release()
}
```

Import a SQL file with the connector's `importFile` method:

```js
await fastify.mariadb.importFile({ file: './schema.sql' })
```

Set connector options such as `pipelining`, `ssl`, and `trace` in `register`. TLS and authentication depend on your server configuration.

Full reference: [connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options) · [Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api).

If the database is unavailable while registering a pool, set the connector's `acquireTimeout` below Fastify's `pluginTimeout` so the pool error reaches Fastify before its plugin startup timeout.

## TypeScript

The four exposed client types are `MariaDBPool`, `MariaDBPromisePool`, `MariaDBConnection`, and `MariaDBPromiseConnection`. Use a type matching your `promise` and `type` options:

```ts
import type { MariaDBPromisePool } from '@melroy89/fastify-mariadb'

declare module 'fastify' {
  interface FastifyInstance {
    mariadb: MariaDBPromisePool
  }
}
```

Since version 1.0.3, the package supplies separate ESM and CommonJS declarations. Each resolves the matching MariaDB connector types, so an ESM Fastify application can use `MariaDBPromisePool` directly alongside types imported from `mariadb`. The plugin still supports both `import` and `require` at runtime.

`MariaDBPromisePool` describes the object decorating `fastify.mariadb`. Its `.pool` property is the underlying MariaDB promise `Pool`; `getConnection()` borrows a connection from that pool. Fastify closes the pool when the application closes.

Runtime guards `isMariaDBPool`, `isMariaDBPromisePool`, `isMariaDBConnection`, and `isMariaDBPromiseConnection` are also exported. The client has a `kind` field with one of `callback-pool`, `promise-pool`, `callback-connection`, or `promise-connection`.

## Acknowledgments

This project is based on [@fastify/mysql](https://github.com/fastify/fastify-mysql). Thanks to its maintainers and contributors for their work.

## License

Licensed under [MIT](./LICENSE).
