import { format } from './formatter/formatter';
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '../test_folder/repro_empty_note.dbml');
const content = fs.readFileSync(filePath, 'utf-8');

const formatted = format(content);

console.log('--- Formatted Output ---');
console.log(formatted);

if (formatted.includes('Note: ""')) {
    console.log('SUCCESS: Empty note added.');
} else {
    console.error('FAILURE: Empty note NOT added.');
    process.exit(1);
}
