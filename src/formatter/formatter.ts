import { Token, TokenType, tokenize } from './tokenizer';

export interface FormatterOptions {
    indentSize?: number;
    useTabs?: boolean;
    orderField?: boolean;
}

export function format(input: string, options: FormatterOptions = {}): string {
    const rawTokens = tokenize(input);
    const indentSize = options.indentSize || 2;
    const indentChar = options.useTabs ? '\t' : ' ';
    const oneIndent = indentChar.repeat(indentSize);

    // Initial Pass: Identify Block Types and context
    // Actually we can process linearly but when we hit `Table {`, we switch to "buffer mode".
    
    let output = '';
    let indentLevel = 0;
    
    // Helper to get current indentation string
    const getIndent = () => oneIndent.repeat(Math.max(0, indentLevel));

    let i = 0;
    while (i < rawTokens.length) {
        let token = rawTokens[i];
        
        // --- Lookahead to detect start of Table block ---
        if (token.type === TokenType.Symbol && token.value === '{') {
             // Identify if this is a Table block
             let isTable = false;
             let backIndex = i - 1;
             while(backIndex >= 0 && (rawTokens[backIndex].type === TokenType.Whitespace || rawTokens[backIndex].type === TokenType.Comment)) {
                 backIndex--;
             }
             // Determine block keyword (heuristic search back)
             let searchIndex = backIndex;
             while (searchIndex >= 0) {
                 const t = rawTokens[searchIndex];
                 if (t.type === TokenType.Symbol && (t.value === '}' || t.value === '{')) break;
                 if (t.type === TokenType.Word) {
                     // Check case-insensitive
                     if (t.value.toLowerCase() === 'table') {
                         isTable = true;
                         break;
                     }
                 }
                 searchIndex--;
             }

             if (isTable) {
                 // BUFFER MODE
                 // 1. Flush/print the '{'
                 // Should ensure space before '{'
                 if (output.length > 0 && !output.endsWith(' ') && !output.endsWith('\n')) {
                     output += ' ';
                 }
                 output += '{';
                 output += '\n';
                 indentLevel++;
                 i++;
                 
                 // 2. Collect tokens inside `{ ... }`
                 const buffer: Token[] = [];
                 let depth = 1;
                 while (i < rawTokens.length) {
                     const t = rawTokens[i];
                     if (t.type === TokenType.Symbol && t.value === '{') depth++;
                     if (t.type === TokenType.Symbol && t.value === '}') {
                         depth--;
                         if (depth === 0) break; // Found end of table
                     }
                     buffer.push(t);
                     i++;
                 }
                 // Now `rawTokens[i]` is the closing `}` (or we ran out)
                 
                 // 3. Process the buffer
                 //    a. Separate into logical "lines" (statements)
                 //    b. Identify Table Note
                 //    c. Identify Field Lines
                 
                 let tableNoteTokens: Token[] = [];
                 const otherLinesGroups: Token[][] = [];
                 
                 // Split buffer into "line groups".
                 // A line group is a set of tokens ending with newline(s).
                 let currentGroup: Token[] = [];
                 
                 for (let k = 0; k < buffer.length; k++) {
                     const t = buffer[k];
                     
                     // We blindly optimize: split on newline unless inside `nested` brackets.
                     currentGroup.push(t);
                     
                     if (t.type === TokenType.Whitespace && t.value.includes('\n')) {
                         // Check depth
                         let brDepth = 0;
                         for (const gt of currentGroup) {
                             if (gt.type === TokenType.Symbol && gt.value === '[') brDepth++;
                             if (gt.type === TokenType.Symbol && gt.value === ']') brDepth--;
                             if (gt.type === TokenType.Symbol && gt.value === '{') brDepth++;
                             if (gt.type === TokenType.Symbol && gt.value === '}') brDepth--;
                         }
                         
                         if (brDepth === 0) {
                             // End of logical line
                             // Check if it is a Note
                             const meaningful = currentGroup.filter(x => x.type !== TokenType.Whitespace && x.type !== TokenType.Comment);
                             
                             let isNote = false;
                             if (meaningful.length >= 3) {
                                  if (meaningful[0].type === TokenType.Word && meaningful[0].value.toLowerCase() === 'note' &&
                                      meaningful[1].type === TokenType.Symbol && meaningful[1].value === ':') {
                                      isNote = true;
                                  }
                             }
                             
                             if (isNote) {
                                  // This is the table note
                                  tableNoteTokens = currentGroup;
                             } else {
                                  otherLinesGroups.push(currentGroup);
                             }
                             currentGroup = [];
                         }
                     }
                 }
                 if (currentGroup.length > 0) {
                     // Check remaining
                     const meaningful = currentGroup.filter(x => x.type !== TokenType.Whitespace && x.type !== TokenType.Comment);
                     
                     let isNote = false;
                     if (meaningful.length >= 3) {
                          if (meaningful[0].type === TokenType.Word && meaningful[0].value.toLowerCase() === 'note' &&
                              meaningful[1].type === TokenType.Symbol && meaningful[1].value === ':') {
                              isNote = true;
                          }
                     }
                     
                     if (isNote) {
                         tableNoteTokens = currentGroup;
                     } else {
                         otherLinesGroups.push(currentGroup);
                     }
                 }
                 
                 // 4. Print Table Note first (if exists)
                 if (tableNoteTokens.length > 0) {
                     // Ensure tokens end with newline if they don't?
                     // Usually they contain the newline token.
                     // But if it was the last line of buffer (no newline), we must add one.
                     
                     output += processTokens(tableNoteTokens, indentLevel, indentChar, indentSize, false); 
                     
                     // Rule: after table note add one empty line
                     // So we want `output` to end with `\n\n`.
                     if (output.endsWith('\n\n')) {
                         // already good
                     } else if (output.endsWith('\n')) {
                         output += '\n';
                     } else {
                         output += '\n\n';
                     }
                 } else {
                     // NEW: If no table note, add empty Note: ""
                     output += getIndent() + 'Note: ""\n\n';
                 }

                 // OPTIONAL: Sort Fields within groups
                 if (options.orderField) {
                     // 1. Normalize groups: Detach "Gap" (extra newlines) from content lines.
                     // If a line ends with > 1 newline, split it into [ContentLine] + [EmptyLine]s.
                     
                     const normalized: Token[][] = [];
                     
                     for (const line of otherLinesGroups) {
                         const last = line[line.length - 1];
                         let hasExtraNewline = false;
                         
                         if (last && last.type === TokenType.Whitespace) {
                             const newlineCount = (last.value.match(/\n/g) || []).length;
                             if (newlineCount > 1) {
                                  hasExtraNewline = true;
                                  
                                  // Create stripped line (1 newline)
                                  const newLineTokens = [...line];
                                  newLineTokens[newLineTokens.length - 1] = { 
                                      ...last, 
                                      value: last.value.replace(/\n+/g, '\n') 
                                  };
                                  normalized.push(newLineTokens);
                                  
                                  // Add spacer lines
                                  for(let k=1; k < newlineCount; k++) {
                                      normalized.push([{ type: TokenType.Whitespace, value: '\n', line: 0, column: 0 }]);
                                  }
                             }
                         }
                         
                         if (!hasExtraNewline) {
                             normalized.push(line);
                         }
                     }
                     
                     // Replace otherLinesGroups with normalized version
                     otherLinesGroups.splice(0, otherLinesGroups.length, ...normalized);

                     // 2. Group lines by "is content" and Sort
                     
                     // Helper to check if line is content
                     const isContentLine = (line: Token[]) => {
                         const m = line.filter(x => x.type !== TokenType.Whitespace && x.type !== TokenType.Comment);
                         return m.length > 0;
                     };
                     
                     let i = 0;
                     while(i < otherLinesGroups.length) {
                         if (isContentLine(otherLinesGroups[i])) {
                             // Start of a block
                             let j = i + 1;
                             while(j < otherLinesGroups.length && isContentLine(otherLinesGroups[j])) {
                                 j++;
                             }
                             // Range [i, j) is a content block to sort
                             const block = otherLinesGroups.slice(i, j);
                             // Sort block
                             block.sort((a, b) => {
                                 const getFirstWord = (toks: Token[]) => {
                                     const t = toks.find(x => x.type === TokenType.Word || x.type === TokenType.String);
                                     return t ? t.value.replace(/^"|"$/g, '').toLowerCase() : '';
                                 };
                                 const wa = getFirstWord(a);
                                 const wb = getFirstWord(b);
                                 if (wa < wb) return -1;
                                 if (wa > wb) return 1;
                                 return 0;
                             });
                             
                             // Put back
                             for(let k=0; k<block.length; k++) {
                                 otherLinesGroups[i+k] = block[k];
                             }
                             
                             i = j;
                         } else {
                             i++;
                         }
                     }
                 }
                 
                 // 5. Process Fields (Transform -> Align -> Print)
                 
                 // 5a. Transformation Pass
                 for (let lgIdx = 0; lgIdx < otherLinesGroups.length; lgIdx++) {
                     const lineTokens = otherLinesGroups[lgIdx];
                     // Check for Field Settings `[...]` reordering
                     // Find `[` ... `]`
                     let openBracketIdx = -1;
                     let closeBracketIdx = -1;
                     
                     for(let idx=0; idx<lineTokens.length; idx++) {
                         if (lineTokens[idx].type === TokenType.Symbol && lineTokens[idx].value === '[') openBracketIdx = idx;
                         if (lineTokens[idx].type === TokenType.Symbol && lineTokens[idx].value === ']') closeBracketIdx = idx;
                     }
                     
                     if (openBracketIdx !== -1 && closeBracketIdx !== -1 && closeBracketIdx > openBracketIdx) {
                         // Extract tokens inside
                         const inside = lineTokens.slice(openBracketIdx + 1, closeBracketIdx);
                         // Check if multiline
                         const settings: Token[][] = [];
                         let currentSetting: Token[] = [];
                         for(const t of inside) {
                             if (t.type === TokenType.Symbol && t.value === ',') {
                                 settings.push(currentSetting);
                                 currentSetting = [];
                             } else {
                                 currentSetting.push(t);
                             }
                         }
                         if (currentSetting.length > 0) settings.push(currentSetting);
                         
                         // Identify "note" setting
                         let noteIndex = -1;
                         for(let s=0; s<settings.length; s++) {
                             const sMeaningful = settings[s].filter(x => x.type !== TokenType.Whitespace && x.type !== TokenType.Comment);
                             if (sMeaningful.length > 0 && sMeaningful[0].type === TokenType.Word && sMeaningful[0].value.toLowerCase() === 'note') {
                                 noteIndex = s;
                                 break;
                             }
                         }
                         
                         if (noteIndex > 0) { // If found and NOT already first
                             // Move to front
                             const noteSetting = settings.splice(noteIndex, 1)[0];
                             settings.unshift(noteSetting);
                             
                             // Reconstruct lineTokens
                             const newInside: Token[] = [];
                             for(let s=0; s<settings.length; s++) {
                                 newInside.push(...settings[s]);
                                 if (s < settings.length - 1) {
                                     newInside.push({ type: TokenType.Symbol, value: ',', line: 0, column: 0 });
                                 }
                             }
                             
                             // Replace in lineTokens
                             lineTokens.splice(openBracketIdx + 1, closeBracketIdx - openBracketIdx - 1, ...newInside);
                         }
                     }
                     
                     // Apply "Empty Field Note" logic
                     const meaningful = lineTokens.filter(t => t.type !== TokenType.Whitespace && t.type !== TokenType.Comment);
                     // Heuristic: Is this a field? 
                     // It should have at least 2 tokens (Name, Type). 
                     // It should NOT be 'indexes'.
                     // It should NOT contain '{' (which would imply a block start like indexes { )
                     
                     let isField = false;
                     if (meaningful.length >= 2) {
                         const firstWord = meaningful[0].value.toLowerCase();
                         if (firstWord !== 'indexes' && firstWord !== 'note') {
                              // Check for braces in original lineTokens to avoid sub-blocks
                              const hasBrace = lineTokens.some(t => t.type === TokenType.Symbol && t.value === '{');
                              if (!hasBrace) {
                                  isField = true;
                              }
                         }
                     }
                     
                     if (isField) {
                         // Find settings block
                         let openBracketIdx = -1;
                         let closeBracketIdx = -1;
                         for(let idx=0; idx<lineTokens.length; idx++) {
                             if (lineTokens[idx].type === TokenType.Symbol && lineTokens[idx].value === '[') openBracketIdx = idx;
                             if (lineTokens[idx].type === TokenType.Symbol && lineTokens[idx].value === ']') closeBracketIdx = idx;
                         }
                         
                         if (openBracketIdx !== -1 && closeBracketIdx !== -1 && closeBracketIdx > openBracketIdx) {
                             // Settings exist. Check if 'note' is present.
                             const inside = lineTokens.slice(openBracketIdx + 1, closeBracketIdx);
                             let hasNote = false;
                             
                             // Simple token scan for 'note' word
                             // Ideally we should parse comma groups, but 'note' keyword is reserved in settings.
                             for (const t of inside) {
                                 if (t.type === TokenType.Word && t.value.toLowerCase() === 'note') {
                                     hasNote = true;
                                     break;
                                 }
                             }
                             
                             if (!hasNote) {
                                 // Insert `note: ""` at the beginning of settings
                                 // We need to insert: "note", ":", "\"\"", ","
                                 const newTokens: Token[] = [
                                     { type: TokenType.Word, value: 'note', line: 0, column: 0 },
                                     { type: TokenType.Symbol, value: ':', line: 0, column: 0 },
                                     { type: TokenType.String, value: '""', line: 0, column: 0 },
                                     { type: TokenType.Symbol, value: ',', line: 0, column: 0 }
                                 ];
                                 lineTokens.splice(openBracketIdx + 1, 0, ...newTokens);
                             }
                         } else {
                             // No settings exist. Append ` [note: ""]`.
                             
                             // Find last meaningful token index
                             let lastMeaningfulIdx = -1;
                             for (let idx = lineTokens.length - 1; idx >= 0; idx--) {
                                 if (lineTokens[idx].type !== TokenType.Whitespace && lineTokens[idx].type !== TokenType.Comment) {
                                     lastMeaningfulIdx = idx;
                                     break;
                                 }
                             }
                             
                             if (lastMeaningfulIdx !== -1) {
                                 const appendTokens: Token[] = [
                                     { type: TokenType.Symbol, value: '[', line: 0, column: 0 },
                                     { type: TokenType.Word, value: 'note', line: 0, column: 0 },
                                     { type: TokenType.Symbol, value: ':', line: 0, column: 0 },
                                     { type: TokenType.String, value: '""', line: 0, column: 0 },
                                     { type: TokenType.Symbol, value: ']', line: 0, column: 0 }
                                 ];
                                 lineTokens.splice(lastMeaningfulIdx + 1, 0, ...appendTokens);
                             }
                         }
                     }

                     // Apply "Quote Data Types" logic
                    let wordCount = 0;
                    for (const t of lineTokens) {
                         // Only count words before `[`?
                         if (t.type === TokenType.Symbol && t.value === '[') break;
                         if (t.type === TokenType.Word) {
                             wordCount++;
                             if (wordCount === 2) {
                                 // Quote this token!
                                 t.value = `"${t.value}"`; 
                             }
                         }
                         if (t.type === TokenType.String && wordCount < 2) { 
                             wordCount++; 
                         }
                    }
                 }

                 // 5b. Alignment Pass
                 const isFieldLine = (tokens: Token[]) => {
                     const m = tokens.filter(t => t.type !== TokenType.Whitespace && t.type !== TokenType.Comment);
                     if (m.length < 2) return false;
                     const first = m[0].value.toLowerCase();
                     if (first === 'indexes' || first === 'note') return false;
                     if (tokens.some(t => t.type === TokenType.Symbol && t.value === '{')) return false;
                     return true;
                 };

                 const alignFieldBlock = (blockLines: Token[][]) => {
                     // 1. Collect info suitable for alignment
                     interface RowInfo {
                         lineTokens: Token[];
                         nameTokenIdx: number;
                         typeStartIdx: number;
                         typeEndIdx: number; // exclusive
                         settingsStartIdx: number;
                         
                         nameWidth: number;
                         typeWidth: number;
                     }
                     
                     const rows: RowInfo[] = [];
                     
                     for (const line of blockLines) {
                         // Find Name Token (First meaningful)
                         let nameIdx = -1;
                         for(let k=0; k<line.length; k++) {
                             if (line[k].type !== TokenType.Whitespace && line[k].type !== TokenType.Comment) {
                                 nameIdx = k;
                                 break;
                             }
                         }
                         if (nameIdx === -1) continue;
                         
                         // Find Settings Start `[`
                         let settingsIdx = -1;
                         for(let k=0; k<line.length; k++) {
                             if (line[k].type === TokenType.Symbol && line[k].value === '[') {
                                 settingsIdx = k;
                                 break;
                             }
                         }
                         
                         if (settingsIdx === -1) continue; // Should have settings by now due to transformation
                         
                         // Type is between Name and Settings
                         // Need to identify start/end of type
                         // Name is at nameIdx.
                         // Type starts after name. (Skip whitespace)
                         let typeStart = nameIdx + 1;
                         while(typeStart < settingsIdx && (line[typeStart].type === TokenType.Whitespace || line[typeStart].type === TokenType.Comment)) {
                             typeStart++;
                         }
                         
                         // Type ends at settingsIdx.
                         // Let's verify we have content.
                         if (typeStart >= settingsIdx) continue;
                         
                         // Calculate Widths
                         const nameWidth = line[nameIdx].value.length;
                         
                         // Dry run type width
                         const typeTokens = line.slice(typeStart, settingsIdx);
                         const typeStr = processTokens(typeTokens, 0, ' ', 2, false); 
                         const typeWidth = typeStr.length;
                         
                         rows.push({
                             lineTokens: line,
                             nameTokenIdx: nameIdx,
                             typeStartIdx: typeStart,
                             typeEndIdx: settingsIdx,
                             settingsStartIdx: settingsIdx,
                             nameWidth,
                             typeWidth
                         });
                     }
                     
                     if (rows.length === 0) return;
                     
                     // 2. Calc Max Widths
                     const maxNameWidth = Math.max(...rows.map(r => r.nameWidth));
                     const maxTypeWidth = Math.max(...rows.map(r => r.typeWidth));
                     
                     // 3. Apply Padding
                     for (const row of rows) {
                         // Pad Name
                         const namePad = (maxNameWidth - row.nameWidth) + 1; // +1 for minimum space
                         const nameTok = row.lineTokens[row.nameTokenIdx];
                         nameTok.padRight = namePad;
                         
                         // Pad Type (Last token of type sequence)
                         const typePad = (maxTypeWidth - row.typeWidth) + 1;
                         // Find the last meaningful token of Type sequence
                         // typeEndIdx is exclusive (index of `[`).
                         let lastTypeTokIdx = row.typeEndIdx - 1;
                         while(lastTypeTokIdx >= row.typeStartIdx && (row.lineTokens[lastTypeTokIdx].type === TokenType.Whitespace || row.lineTokens[lastTypeTokIdx].type === TokenType.Comment)) {
                             lastTypeTokIdx--;
                         }
                         
                         if (lastTypeTokIdx >= row.typeStartIdx) {
                             row.lineTokens[lastTypeTokIdx].padRight = typePad;
                         }
                     }
                 };

                 let fieldBlockStart = -1;
                 for (let i = 0; i <= otherLinesGroups.length; i++) {
                     const line = i < otherLinesGroups.length ? otherLinesGroups[i] : null;
                     const isField = line ? isFieldLine(line) : false;
                     
                     if (isField) {
                         if (fieldBlockStart === -1) fieldBlockStart = i;
                     } else {
                         if (fieldBlockStart !== -1) {
                             alignFieldBlock(otherLinesGroups.slice(fieldBlockStart, i));
                             fieldBlockStart = -1;
                         }
                     }
                 }

                 // 5c. Print Pass
                 for (let lgIdx = 0; lgIdx < otherLinesGroups.length; lgIdx++) {
                     const lineTokens = otherLinesGroups[lgIdx];
                     output += processTokens(lineTokens, indentLevel, indentChar, indentSize, true);
                    
                     if (lgIdx < otherLinesGroups.length - 1) {
                         if (!output.endsWith('\n')) {
                              output += '\n';
                         }
                     }
                 }
                 
                 // End block
                 indentLevel--; 
                 if (!output.endsWith('\n')) output += '\n';
                 output += getIndent() + '}'; 
                 
                 // Rule: after table close } add on empty line
                 output += '\n'; // This ensures at least one newline after `}`
                 // To ensure "one empty line", we need two newlines total?
                 // `output` ends with `}\n`.
                 // If we add `\n`, it becomes `}\n\n`.
                 output += '\n'; 
                 
                 if (i < rawTokens.length && rawTokens[i].type === TokenType.Symbol && rawTokens[i].value === '}') {
                     i++;
                 }

                 continue; // Continue outer loop
             }
        }
        
    // Linear Loop Fallback Logic needs to use `processTokens` properly or duplicate spacing logic
    // Actually, the issue is that in the fallback loop:
    // `output += processTokens([token], ...)` 
    // `processTokens` checks `localOutput` (which is empty for that call) to decide spacing.
    // It doesn't know about `output`'s tail.
    
    // Fix: We must pass `output` context to `processTokens`, or handle spacing BEFORE calling `processTokens`.
    
    // Easier Fix: Centralize "appendToken" logic.
    
    // Let's rewrite the main loop to handle spacing explicitly before appending.
    
    // But `processTokens` handles a list.
    
    // Let's modify `processTokens` to accept `previousChar` or `needsSpaceCheck`?
    
    // Actually, `processTokens` is used for buffered content (Table block).
    // The main loop handles non-buffered content.
    
    // The previous implementation was:
    /*
        if (output.length > 0) {
            let needsSpace = true;
            // ... checks ...
            if (needsSpace) output += ' ';
        }
        output += token.value;
    */
    
    // In the new implementation:
    /*
        const singleTokenList = [token];
        output += processTokens(singleTokenList, ...);
    */
   
    // `processTokens` internal logic:
    // `if (localOutput.length > 0) { check space }`
    // Since `singleTokenList` has 1 item, `localOutput` is empty initially, so NO SPACE is added.
    
    // We need to restore the spacing logic in the main loop for the fallback case.
    // AND ensuring `processTokens` handles its internal list correctly.
    
    // Let's fix the Main Loop Fallback first.

        // --- Fallback: Standard Linear Processing for non-Table content ---
        
        // Handle whitespace first
        if (token.type === TokenType.Whitespace) {
            const newlines = (token.value.match(/\n/g) || []).length;
            if (newlines > 0) {
                 const toPrint = Math.min(newlines, 2); 
                 if (!output.endsWith('\n')) {
                    output += '\n'.repeat(toPrint);
                 } else {
                    if (toPrint > 1 && !output.endsWith('\n\n')) {
                        output += '\n';
                    }
                 }
            }
            i++;
            continue;
        }

        // Apply spacing based on GLOBAL `output`
        if (output.endsWith('\n')) {
             if (token.value !== '}') {
                 output += getIndent();
             }
        } else if (output.length > 0) {
            let needsSpace = true;
            const lastChar = output[output.length - 1];
            if (lastChar === ' ' || lastChar === '\n' || lastChar === '(' || lastChar === '[' || lastChar === '.') {
                needsSpace = false;
            }
            if (token.type === TokenType.Symbol) {
                 if (token.value === ',' || token.value === ']' || token.value === ')' || token.value === '.' || token.value === ':') {
                     needsSpace = false;
                 }
                 // Ref: > or < logic?
            }
            if (needsSpace) output += ' ';
        }
        
        // Output with Keyword Normalization
        switch (token.type) {
            case TokenType.Word:
                // Global Keyword PascalCase
                // table -> Table
                if (token.value.toLowerCase() === 'table') {
                    token.value = 'Table';
                }
                
                // ref -> Ref
                if (token.value.toLowerCase() === 'ref') {
                    token.value = 'Ref';
                }
                
                // note -> Note (if followed by colon?)
                if (token.value.toLowerCase() === 'note') {
                     // Check next token for `:`
                     let nextIdx = i + 1;
                     while(nextIdx < rawTokens.length && (rawTokens[nextIdx].type === TokenType.Whitespace || rawTokens[nextIdx].type === TokenType.Comment)) {
                         nextIdx++;
                     }
                     if (nextIdx < rawTokens.length && rawTokens[nextIdx].type === TokenType.Symbol && rawTokens[nextIdx].value === ':') {
                         token.value = 'Note';
                     }
                }
                
                output += token.value;
                break;
                
            case TokenType.String:
                let val = token.value;
                if (val.startsWith("'") && !val.startsWith("'''")) {
                    const content = val.slice(1, -1);
                    const escaped = content.replace(/"/g, '\\"');
                    val = `"${escaped}"`;
                }
                output += val;
                break;
            default:
                output += token.value;
                break;
        }
        
        i++;
    }

    return output.trim() + '\n';
}

// ... helper functions ...

function processTokens(
    tokens: Token[], 
    baseIndentLevel: number, 
    indentChar: string, 
    indentSize: number, 
    isInsideTable: boolean
): string {
    
    let localOutput = '';
    let currentIndentLevel = baseIndentLevel;
    const oneIndent = indentChar.repeat(indentSize);
    const getLocalIndent = () => oneIndent.repeat(Math.max(0, currentIndentLevel));
    
    // ... multiline stack and checkArrayMultiline ...
     const checkArrayMultiline = (startIdx: number): boolean => {
         let depth = 1;
         let hasComma = false;
         for (let k = startIdx + 1; k < tokens.length; k++) {
             if (tokens[k].type === TokenType.Symbol && tokens[k].value === '[') depth++;
             if (tokens[k].type === TokenType.Symbol && tokens[k].value === ']') depth--;
             if (depth === 1 && tokens[k].type === TokenType.Symbol && tokens[k].value === ',') hasComma = true;
             if (depth === 0) return hasComma;
         }
         return false;
    };
    
    const multilineArrayStack: boolean[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        // Whitespace handling
        if (token.type === TokenType.Whitespace) {
            const newlines = (token.value.match(/\n/g) || []).length;
            if (newlines > 0) {
                 const toPrint = Math.min(newlines, 2); 
                 if (!localOutput.endsWith('\n')) {
                    localOutput += '\n'.repeat(toPrint);
                 } else {
                    if (toPrint > 1 && !localOutput.endsWith('\n\n')) {
                        localOutput += '\n';
                    }
                 }
            }
            continue;
        }

        // Corrected Spacing/Indent Logic for processTokens:
        if (localOutput.length === 0 || localOutput.endsWith('\n')) {
             if (token.value !== '}') {
                 localOutput += getLocalIndent();
             }
        } else {
             // Not start of line
            let needsSpace = true;
            const lastChar = localOutput[localOutput.length - 1];
             if (lastChar === ' ' || lastChar === '\n' || lastChar === '(' || lastChar === '[' || lastChar === '.') {
                needsSpace = false;
            }
            if (token.type === TokenType.Symbol) {
                 if (token.value === ',' || token.value === ']' || token.value === ')' || token.value === '.' || token.value === ':') {
                     needsSpace = false;
                 }
            }
            if (needsSpace) localOutput += ' ';
        }



        switch (token.type) {
             case TokenType.Symbol:
                 if (token.value === '{') {
                      localOutput += '{\n';
                      currentIndentLevel++;
                 } else if (token.value === '}') {
                      if (!localOutput.endsWith('\n')) localOutput += '\n';
                      currentIndentLevel--;
                      localOutput += getLocalIndent() + '}';
                 } else if (token.value === '[') {
                      const isMultiline = checkArrayMultiline(i);
                      multilineArrayStack.push(isMultiline);
                      localOutput += '[';
                      if (isMultiline) {
                          localOutput += '\n';
                          currentIndentLevel++;
                      }
                 } else if (token.value === ']') {
                      const isMultiline = multilineArrayStack.pop();
                      if (isMultiline) {
                          if (!localOutput.endsWith('\n')) localOutput += '\n';
                          currentIndentLevel--;
                          if (localOutput.endsWith('\n')) localOutput += getLocalIndent();
                      }
                      localOutput += ']';
                 } else if (token.value === ',') {
                      localOutput += ',';
                      const currentMultiline = multilineArrayStack.length > 0 && multilineArrayStack[multilineArrayStack.length - 1];
                      if (currentMultiline) localOutput += '\n';
                 } else {
                      localOutput += token.value;
                 }
                 break;
             
             case TokenType.Word:
                  // Handle keyword PascalCase in buffer
                  if (token.value.toLowerCase() === 'table') token.value = 'Table';
                  if (token.value.toLowerCase() === 'ref') token.value = 'Ref';
                  if (token.value.toLowerCase() === 'note') {
                       // Peek locally inside tokens list
                        let nextIdx = i + 1;
                        while(nextIdx < tokens.length && (tokens[nextIdx].type === TokenType.Whitespace || tokens[nextIdx].type === TokenType.Comment)) {
                            nextIdx++;
                        }
                        if (nextIdx < tokens.length && tokens[nextIdx].type === TokenType.Symbol && tokens[nextIdx].value === ':') {
                            token.value = 'Note';
                        }
                  }
                  localOutput += token.value;
                  break;

             case TokenType.String:
                let val = token.value;
                if (val.startsWith("'") && !val.startsWith("'''")) {
                    const content = val.slice(1, -1);
                    const escaped = content.replace(/"/g, '\\"');
                    val = `"${escaped}"`;
                }
                localOutput += val;
                break;
                
             default:
                localOutput += token.value;
                break;
        }

        if (token.padRight) {
             localOutput += ' '.repeat(token.padRight);
        }
    }
    
    return localOutput;
}
