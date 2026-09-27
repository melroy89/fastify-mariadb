import type { FastifyPluginCallback } from 'fastify'
import type { Connection as PromiseConnection, Pool as PromisePool, ConnectionConfig, PoolConfig } from 'mariadb'
import type { Connection, Pool } from 'mariadb/callback'

type FastifyMariadb = FastifyPluginCallback<fastifyMariadb.FastifyMariaDBOptions>

declare namespace fastifyMariadb {
  export type MariaDBConnection = Pick<Connection, 'query' | 'execute' | 'escape' | 'escapeId' | 'batch' | 'importFile' | 'queryStream'> & {
    kind: 'callback-connection';
    connection: Connection;
  }
  export type MariaDBPool = Pick<Pool, 'query' | 'execute' | 'getConnection' | 'escape' | 'escapeId' | 'batch' | 'importFile'> & {
    kind: 'callback-pool';
    pool: Pool;
  }
  export type MariaDBPromiseConnection = Pick<PromiseConnection, 'query' | 'execute' | 'escape' | 'escapeId' | 'batch' | 'importFile' | 'queryStream'> & {
    kind: 'promise-connection';
    connection: PromiseConnection;
  }
  export type MariaDBPromisePool = Pick<PromisePool, 'query' | 'execute' | 'getConnection' | 'escape' | 'escapeId' | 'batch' | 'importFile'> & {
    kind: 'promise-pool';
    pool: PromisePool;
  }

  export type MariaDBClient = MariaDBConnection | MariaDBPool | MariaDBPromiseConnection | MariaDBPromisePool
  export function isMariaDBConnection (obj: unknown): obj is MariaDBConnection
  export function isMariaDBPool (obj: unknown): obj is MariaDBPool
  export function isMariaDBPromiseConnection (obj: unknown): obj is MariaDBPromiseConnection
  export function isMariaDBPromisePool (obj: unknown): obj is MariaDBPromisePool

  export type ConnectionType = 'connection' | 'pool'
  export type FastifyMariaDBOptions = PoolConfig & ConnectionConfig & {
    type?: ConnectionType;
    name?: string;
    promise?: boolean;
    connectionString?: string;
  }

  export const fastifyMariadb: FastifyMariadb
  export { fastifyMariadb as default }
}

declare function fastifyMariadb (...params: Parameters<FastifyMariadb>): ReturnType<FastifyMariadb>
export = fastifyMariadb
