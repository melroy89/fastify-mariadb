import plugin = require('@melroy89/fastify-mariadb')
import type { Pool } from 'mariadb'
import { expect } from 'tstyche'

declare const decorated: plugin.MariaDBPromisePool

expect(plugin).type.toBeAssignableTo<typeof plugin.fastifyMariadb>()
expect(decorated.pool).type.toBe<Pool>()
expect(decorated.execute).type.toBe<Pool['execute']>()
