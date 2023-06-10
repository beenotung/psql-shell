# psql-shell

psql shell that can display Chinese words (unicode) in windows powershell

[![npm Package Version](https://img.shields.io/npm/v/psql-shell)](https://www.npmjs.com/package/psql-shell)

## Installation (optional)

```bash
npm i -g psql-shell
```

## Usage

Usage with global install:

```bash
psql-shell
```

Usage without global install:

```bash
npx -y psql-shell
```

## Database Credential

The connection credential, e.g. username, password, and database name are loaded in multiple places, including:

- environment variables
- .env file
- ask from cli interactively

Name of environment variables:

- `DB_NAME`
- `DB_USER` or `DB_USERNAME`
- `DB_PASS` or `DB_PASSWORD`
- `DB_HOST` or `DB_HOSTNAME` (default: "localhost")
- `DB_PORT` (default: 5432)

## License

This project is licensed with [BSD-2-Clause](./LICENSE)

This is free, libre, and open-source software. It comes down to four essential freedoms [[ref]](https://seirdy.one/2021/01/27/whatsapp-and-the-domestication-of-users.html#fnref:2):

- The freedom to run the program as you wish, for any purpose
- The freedom to study how the program works, and change it so it does your computing as you wish
- The freedom to redistribute copies so you can help others
- The freedom to distribute copies of your modified versions to others
