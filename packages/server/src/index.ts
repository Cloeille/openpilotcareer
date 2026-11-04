import { hello } from '@opc/shared';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
console.log(hello(2), db.prepare('select sqlite_version() v').get());
