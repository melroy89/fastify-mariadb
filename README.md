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

Promise queries return rows directly. For writes they return a result object. To obtain field metadata alongside rows, set the connector option `metaAsArray: true`; the result then has a `[rows, metadata]` shape.

A pool connection must be released after use:

```js
const connection = await fastify.mariadb.getConnection()
try {
  await connection.query('SELECT 1')
} finally {
  await connection.release()
}
```

## Callback API

The default is the connector's callback API. Query callbacks receive `(error, rows, metadata)`.

```js
fastify.register(require('@melroy89/fastify-mariadb'), {
  host: 'localhost',
  user: 'root',
  database: 'app'
})

fastify.mariadb.query('SELECT ? AS value', [1], (error, rows, metadata) => {
  if (error) throw error
  console.log(rows[0].value, metadata)
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

`fastify.mariadb` exposes `query`, `execute`, `batch`, `importFile`, `escape`, and `escapeId`. Pool mode also exposes `pool` and `getConnection`. Connection mode exposes `connection` and `queryStream`. The underlying connector instance provides its additional methods. The plugin does not provide a `format` helper; use query placeholders instead.

For bulk writes, `batch` uses the connector's bulk operation support:

```js
await fastify.mariadb.batch(
  'INSERT INTO users (name) VALUES (?)',
  [['Ada'], ['Grace']]
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

Connection options such as TLS configuration, authentication plugins, pipelining, and metadata handling are passed to the connector. See the [connector documentation](https://mariadb.com/docs/connectors/mariadb-connector-nodejs) for their behavior. This plugin does not add its own performance guarantees.

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

Runtime guards `isMariaDBPool`, `isMariaDBPromisePool`, `isMariaDBConnection`, and `isMariaDBPromiseConnection` are also exported. The client has a `kind` field with one of `callback-pool`, `promise-pool`, `callback-connection`, or `promise-connection`.

## Acknowledgments

This project is based on [@fastify/mysql](https://github.com/fastify/fastify-mysql). Thanks to its maintainers and contributors for their work.

## License

Licensed under [MIT](./LICENSE).
