#!/usr/bin/env node

import pg from 'pg'
import { config } from 'dotenv'
import readline, { Interface } from 'readline'
import Knex, { Knex as KnexType } from 'knex'
import { scanPGTableSchema } from 'quick-erd/dist/db/pg-to-text'
import { tableToString } from 'quick-erd/dist/core/table'
import { readFile, readFileSync } from 'fs'
import { join } from 'path'

function parseArgs() {
  let database: string | undefined
  let user: string | undefined
  let password: string | undefined | null
  let host = 'localhost'
  let port = 5432
  for (let i = 2; i < process.argv.length; i++) {
    let arg = process.argv[i]
    switch (arg) {
      case '--help':
        console.log(readFileSync(join(__dirname, '..', 'README.md')).toString())
        process.exit(0)
      case '-d':
        i++
        database = process.argv[i]
        if (!database) {
          console.error('Missing database name in argument.')
          process.exit(1)
        }
        break
      case '-U': {
        i++
        user = process.argv[i]
        if (!user) {
          console.error('Missing user name in argument.')
          process.exit(1)
        }
        break
      }
      case '-h': {
        i++
        host = process.argv[i]
        if (!host) {
          console.error('Missing database server host in argument.')
          process.exit(1)
        }
        break
      }
      case '-P': {
        i++
        port = +process.argv[i]
        if (!port) {
          console.error('Missing database server port in argument.')
          process.exit(1)
        }
        break
      }
      case '-w': {
        console.log('database password is required')
        break
      }
      case '-W': {
        break
      }
      default: {
        if (!database) {
          database = arg
          break
        }
        if (!user) {
          user = arg
          break
        }
        console.error('Extra argument:', process.argv.slice(i))
        process.exit(1)
      }
    }
  }
  return { database, user, password, host, port }
}

async function main() {
  let io: Interface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  let client: pg.Client | undefined
  let knex: KnexType | undefined

  function ask(query: string) {
    return new Promise<string>((resolve, reject) => {
      io.question(query, resolve)
    })
  }

  async function getConnection() {
    config()

    let { database, user, password, host, port } = parseArgs()

    database ||= process.env.DB_NAME || (await ask('database name: '))
    if (!database) throw new Error('missing database name')

    user ||=
      process.env.DB_USER ||
      process.env.DB_USERNAME ||
      (await ask(`database user (default ${database}): `)) ||
      database
    if (!user) throw new Error('missing database user')

    password ||=
      process.env.DB_PASSWORD ||
      process.env.DB_PASS ||
      (await ask(`database password (default ${user}): `)) ||
      user
    if (!password) throw new Error('missing database password')

    host ||=
      process.env.DB_HOST ||
      process.env.DB_HOSTNAME ||
      (await ask('database host (default localhost): ')) ||
      'localhost'

    port ||=
      +process.env.DB_PORT! ||
      +(await ask('database port (default 5432): ')) ||
      5432

    let client = new pg.Client({ database, user, password, host, port })
    await client.connect()

    return { client, database, user, password, host, port }
  }

  try {
    let connection = await getConnection()
    client = connection.client
    let { database, user, password, host, port } = connection

    async function querySingleColumn(sql: string) {
      let result = await client!.query(sql)
      let field = result.fields[0].name
      console.log(result.rows.map(row => row[field]).join(', '))
    }

    function getKnex() {
      if (!knex) {
        knex = Knex({
          client: 'pg',
          connection: {
            database,
            user,
            password,
            host,
            port,
          },
        })
      }
      return knex
    }

    let text = ''
    for (;;) {
      try {
        text += ' '
        text += await ask(`${database}=# `)
        text = text.trim()
        if (!text) continue
        if (text.startsWith('\\q')) break
        if (text.startsWith('\\c')) {
          let db = text.match(/\\c ([\w-_]+)/)?.[1]
          if (db) {
            client.end()
            database = db
            client = new pg.Client({ database, user, password, host, port })
            await client.connect()
          }
          console.log(
            `You are now connected to database "${database}" as user "${user}"`,
          )
          text = ''
          continue
        }
        if (text.startsWith('\\l')) {
          await querySingleColumn(/* sql */ `select datname from pg_database`)
          text = ''
          continue
        }
        if (text.startsWith('\\d+')) {
          let result = await client.query(/* sql */ `
select tablename
from pg_tables
where pg_tables.schemaname = 'public'
`)
          let tables = result.rows
          for (let { tablename } of tables) {
            result = await client.query(/* sql */ `
select count(*) as count from "${tablename}"
`)
            let count = result.rows[0].count
            console.log({ tablename, count })
          }
          text = ''
          continue
        }
        if (text.startsWith('\\d')) {
          let tableName = text.replace('\\d', '').replace(';', '').trim()
          if (tableName) {
            let tables = await scanPGTableSchema(getKnex())
            let table = tables.find(table => table.name === tableName)
            if (!table) {
              console.log(`Did not find any relation named "${tableName}".`)
              text = ''
              continue
            }
            console.log(tableToString(table).trim())
          } else {
            await querySingleColumn(
              /* sql */ `select tablename from pg_tables where schemaname = 'public'`,
            )
          }
          text = ''
          continue
        }
        if (text.endsWith(';')) {
          let result = await client.query(text)
          console.dir(result.rows, { depth: 20 })
          console.log(result.rowCount, 'rows')
          text = ''
          continue
        }
        // console.log('unknown command:', text)
      } catch (error) {
        console.error({
          query: text,
          error,
        })
        text = ''
      }
    }
  } catch (error) {
    console.error(error)
  } finally {
    io.close()
    client?.end()
    knex?.destroy()
  }
}
main()
