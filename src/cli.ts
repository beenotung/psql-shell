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

function createDefer<T>() {
  let defer = {
    resolve(data: T) {},
    reject(error: any) {},
  }
  let promise = new Promise<T>((resolve, reject) => {
    defer.resolve = resolve
    defer.reject = reject
  })
  return Object.assign(defer, { promise })
}

async function main() {
  let io: Interface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  let clientDefer = createDefer<pg.Client>()
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
    clientDefer.resolve(connection.client)
    let { database, user, password, host, port } = connection

    async function querySingleColumn(sql: string) {
      let client = await clientDefer.promise
      let result = await client.query(sql)
      let field = result.fields[0].name
      showOutput(result.rows.map(row => row[field]).join(', '))
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
    function loop() {
      io.question(`${database}=# `, answer => {
        text = (text + '\n' + answer).trim()
        if (text.startsWith('\\q')) return end()
        onLine().then(result => {
          if (result != 'not-executed') {
            process.stdout.write(`${database}=# `)
          }
        })
        loop()
      })
    }
    loop()

    function erasePrompt() {
      process.stdout.write(`\r${' '.repeat(`${database}=# `.length)}\r`)
    }

    function showOutput(message: any) {
      erasePrompt()
      console.log(message)
    }

    function showRows(rows: object[]) {
      erasePrompt()
      console.dir(rows, { depth: 20 })
      console.log(rows.length, 'rows')
    }

    async function onLine() {
      try {
        if (text.startsWith('\\c')) {
          let db = text.match(/\\c ([\w-_]+)/)?.[1]
          if (db) {
            clientDefer.promise.then(client => client.end())
            database = db
            let client = new pg.Client({ database, user, password, host, port })
            clientDefer = createDefer()
            clientDefer.resolve(client)
            await client.connect()
          }
          showOutput(
            `You are now connected to database "${database}" as user "${user}"`,
          )
          text = ''
          return
        }
        if (text.startsWith('\\l')) {
          await querySingleColumn(/* sql */ `select datname from pg_database`)
          text = ''
          return
        }
        if (text.startsWith('\\d+')) {
          let client = await clientDefer.promise
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
            showOutput({ tablename, count })
          }
          text = ''
          return
        }
        if (text.startsWith('\\d')) {
          let tableName = text.replace('\\d', '').replace(';', '').trim()
          if (tableName) {
            let tables = await scanPGTableSchema(getKnex())
            let table = tables.find(table => table.name === tableName)
            if (!table) {
              showOutput(`Did not find any relation named "${tableName}".`)
              text = ''
              return
            }
            showOutput(tableToString(table).trim())
          } else {
            await querySingleColumn(
              /* sql */ `select tablename from pg_tables where schemaname = 'public'`,
            )
          }
          text = ''
          return
        }
        if (text.endsWith(';')) {
          if (text.startsWith('knex')) {
            let knex = getKnex()
            let rows = await eval(text)
            showRows(rows)
          } else {
            let client = await clientDefer.promise
            let result = await client.query(text)
            showRows(result.rows)
          }
          text = ''
          return
        }
        // console.log('unknown command:', text)
        return 'not-executed'
      } catch (error) {
        erasePrompt()
        console.error({
          query: text,
          error,
        })
        text = ''
      }
    }

    function end() {
      io.close()
      clientDefer.promise.then(client => client.end())
      knex?.destroy()
    }
  } catch (error) {
    console.error(error)
  }
}
main()
