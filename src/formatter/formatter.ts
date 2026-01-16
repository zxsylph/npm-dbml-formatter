import { Token, TokenType, tokenize } from './tokenizer';

export interface FormatterOptions {
    indentSize?: number;
    useTabs?: boolean;
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
                 }
                 
                 // 5. Print other lines (Process Fields)
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
                     
                     // 6. Apply "Quote Data Types" logic
                    let wordCount = 0;
                    for (const t of lineTokens) {
                         // Only count words before `[`?
                         if (t.type === TokenType.Symbol && t.value === '[') break;
                         if (t.type === TokenType.Word) {
                             wordCount++;
                             if (wordCount === 2) {
                                 // Quote this token!
                                 t.value = `"${t.value}"`; 
                                 // Note: we are modifying the token object directly in the buffer.
                             }
                         }
                         if (t.type === TokenType.String && wordCount < 2) { 
                             // Strings count as words/tokens for position?
                             // Example `name "varchar"` -> "varchar" IS the string.
                             wordCount++; 
                         }
                    }

                    // Ensure previous line enforced newline if missing?
                    // processTokens appends tokens. If tokens lack newline, it might merge?
                    // `lineTokens` usually comes from `currentGroup` which ended with newline token (except last one).
                    // If last group lacks newline, and we print next group...
                    
                    // Check if output buffer needs separation?
                    // processTokens logic respects local newlines inside `lineTokens`.
                    // But if `lineTokens` (last group) didn't have newline, we append.
                    
                    output += processTokens(lineTokens, indentLevel, indentChar, indentSize, true);
                    
                    // Heuristic: If we just printed a line group, and it didn't generate a newline at end,
                    // AND there is another group coming, insert newline?
                    // But `processTokens` output might end with proper indent? No.
                    
                    // Let's check `output`.
                    if (lgIdx < otherLinesGroups.length - 1) {
                        if (!output.endsWith('\n')) {
                             // This implies the group didn't end with newline token.
                             // Force it.
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
    }
    
    return localOutput;
}
