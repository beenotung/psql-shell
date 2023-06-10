#!/usr/bin/env node

import pg from 'pg'
import { config } from 'dotenv'
import readline, { Interface } from 'readline'

async function main() {
  let io: Interface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  let client: pg.Client | undefined

  function ask(query: string) {
    return new Promise<string>((resolve, reject) => {
      io.question(query, resolve)
    })
  }

  async function getConnection() {
    config()

    let database = process.env.DB_NAME || (await ask('database name: '))
    if (!database) throw new Error('missing database name')

    let user =
      process.env.DB_USER ||
      process.env.DB_USERNAME ||
      (await ask(`database user (default ${database}): `)) ||
      database
    if (!user) throw new Error('missing database user')

    let password =
      process.env.DB_PASSWORD ||
      process.env.DB_PASS ||
      (await ask(`database password (default ${user}): `)) ||
      user
    if (!password) throw new Error('missing database password')

    let host =
      process.env.DB_HOST ||
      process.env.DB_HOSTNAME ||
      (await ask('database host (default localhost): ')) ||
      'localhost'

    let portStr =
      process.env.DB_PORT ||
      (await ask('database port (default 5432): ')) ||
      '5432'
    let port = +portStr

    let client = new pg.Client({ database, user, password, host, port })
    await client.connect()

    return { client, database, user, password, host, port }
  }

  try {
    let connection = await getConnection()
    client = connection.client
    let { database, user, password, host, port } = connection

    for (;;) {
      let text = await ask(`${database}=# `)
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
        continue
      }
    }
  } catch (error) {
    console.error(error)
  } finally {
    io.close()
    client?.end()
  }
}
main()
