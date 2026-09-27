import fastify from 'fastify'
import fastifyMariadb, {
  isMariaDBPool,
  isMariaDBPromisePool,
  isMariaDBConnection,
  isMariaDBPromiseConnection,
  type MariaDBPool,
  type MariaDBPromisePool,
  type MariaDBConnection,
  type MariaDBPromiseConnection
} from '..'
import type { Pool as PromisePool, Connection as PromiseConnection, FieldInfo } from 'mariadb'
import type { Pool, Connection } from 'mariadb/callback'
import { expect } from 'tstyche'

declare module 'fastify' {
  interface FastifyInstance {
    mariadb: MariaDBPool | MariaDBPromisePool | MariaDBConnection | MariaDBPromiseConnection
  }
}

const app = fastify()
app.register(fastifyMariadb, { host: 'localhost', user: 'root', database: 'test' })
app.register(fastifyMariadb, { connectionString: 'mariadb://root@localhost/test' })

async function checkTypes () {
  if (isMariaDBPool(app.mariadb)) {
    expect(app.mariadb.pool).type.toBe<Pool>()
    app.mariadb.query('SELECT 1', (_err, rows, metadata) => {
      expect(rows).type.toBe<any>()
      expect(metadata).type.toBe<FieldInfo[] | undefined>()
    })
    app.mariadb.getConnection((_err, connection) => connection?.release(() => {}))
  }
  if (isMariaDBPromisePool(app.mariadb)) {
    expect(app.mariadb.pool).type.toBe<PromisePool>()
    const connection = await app.mariadb.getConnection()
    await connection.release()
    const rows = await app.mariadb.query<{ value: number }[]>('SELECT 1 AS value')
    expect(rows).type.toBe<{ value: number }[]>()
  }
  if (isMariaDBConnection(app.mariadb)) {
    expect(app.mariadb.connection).type.toBe<Connection>()
    app.mariadb.execute('SELECT ?', [1], (_err, rows) => { expect(rows).type.toBe<any>() })
  }
  if (isMariaDBPromiseConnection(app.mariadb)) {
    expect(app.mariadb.connection).type.toBe<PromiseConnection>()
    await app.mariadb.execute('SELECT ?', [1])
  }
}

checkTypes()
