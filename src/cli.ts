#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { format } from './formatter/formatter';

const args = process.argv.slice(2);

if (args.length === 0) {
    console.error('Usage: dbml-formatter <file> | --folder <path> [--dry-run]');
    process.exit(1);
}

const folderIndex = args.indexOf('--folder');
const dryRunIndex = args.indexOf('--dry-run');
const orderFieldIndex = args.indexOf('--order-field');
const isDryRun = dryRunIndex !== -1;
const orderField = orderFieldIndex !== -1;

if (folderIndex !== -1) {
    // Folder mode
    const folderPath = args[folderIndex + 1];
    if (!folderPath || folderPath.startsWith('--')) {
        console.error('Error: --folder requires a path argument');
        process.exit(1);
    }

    const absFolderPath = path.resolve(process.cwd(), folderPath);
    if (!fs.existsSync(absFolderPath) || !fs.statSync(absFolderPath).isDirectory()) {
         console.error(`Directory not found: ${absFolderPath}`);
         process.exit(1);
    }

    const getDbmlFiles = (dir: string): string[] => {
        let results: string[] = [];
        const list = fs.readdirSync(dir);
        list.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat && stat.isDirectory()) {
                results = results.concat(getDbmlFiles(filePath));
            } else {
                if (file.endsWith('.dbml')) {
                    results.push(filePath);
                }
            }
        });
        return results;
    };

    const files = getDbmlFiles(absFolderPath);
    
    if (files.length === 0) {
        console.log(`No .dbml files found in ${absFolderPath}`);
    } else {
        files.forEach(file => {
             try {
                const content = fs.readFileSync(file, 'utf-8');
                const formatted = format(content, { orderField, addNote: args.includes('--add-note') });
                
                if (isDryRun) {
                    console.log(`\n--- Dry Run: ${file} ---`);
                    console.log(formatted);
                } else {
                     fs.writeFileSync(file, formatted, 'utf-8');
                     console.log(`Formatted: ${file}`);
                }
             } catch (err) {
                 console.error(`Error formatting ${file}:`, err);
             }
        });
    }

} else {
    // Single file mode
    const filePath = args[0];
    
    if (filePath.startsWith('--')) {
         console.error('Usage: dbml-formatter <file> | --folder <path> [--dry-run]');
         process.exit(1);
    }

    const absPath = path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absPath)) {
        console.error(`File not found: ${absPath}`);
        process.exit(1);
    }

    try {
        const content = fs.readFileSync(absPath, 'utf-8');
        const formatted = format(content, { orderField, addNote: args.includes('--add-note') });
        console.log(formatted);
    } catch (error) {
        console.error('Error formatting file:', error);
        process.exit(1);
    }
}
