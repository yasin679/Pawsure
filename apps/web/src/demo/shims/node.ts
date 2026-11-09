/**
 * Browser stand-ins for node:fs, node:path, node:url and pg in the in-browser demo. The demo never touches the file
 * system or a Postgres server (migrations are bundled, the database is PGlite in memory), so these only need to load.
 */
const unavailable = (name: string) => () => { throw new Error(`${name} is not available in the browser demo`); };
export const readFileSync = unavailable('fs.readFileSync');
export const readdirSync = unavailable('fs.readdirSync');
export const writeFileSync = unavailable('fs.writeFileSync');
export const rmSync = unavailable('fs.rmSync');
export const mkdirSync = () => undefined;
export const join = (...p: string[]) => p.filter(Boolean).join('/');
export const dirname = (p: string) => p.split('/').slice(0, -1).join('/');
export const fileURLToPath = (u: string) => String(u);
const pg = { Pool: unavailable('pg.Pool') };
export default { readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync, join, dirname, fileURLToPath, ...pg };
export const Pool = pg.Pool;
