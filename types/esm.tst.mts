import plugin, { fastifyMariadb, isMariaDBPromisePool, type MariaDBPromisePool } from '@melroy89/fastify-mariadb'
import type { FieldInfo, Pool, PoolConnection } from 'mariadb'
import { expect } from 'tstyche'

declare const decorated: MariaDBPromisePool

expect(plugin).type.toBe<typeof fastifyMariadb>()
expect(decorated.pool).type.toBe<Pool>()
expect(decorated.getConnection()).type.toBe<Promise<PoolConnection>>()
expect(decorated.execute).type.toBe<Pool['execute']>()
expect(decorated.query).type.toBe<Pool['query']>()

decorated.query({ sql: 'SELECT 1', typeCast: (field, next) => {
  expect(field).type.toBe<FieldInfo>()
  return next()
} })

const client: unknown = decorated
if (isMariaDBPromisePool(client)) expect(client).type.toBe<MariaDBPromisePool>()
