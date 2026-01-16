export enum TokenType {
    Whitespace,
    Comment,
    String,
    Symbol,
    Word,
    Unknown
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
    padRight?: number;
}

export function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let current = 0;
    let line = 1;
    let column = 1;

    while (current < input.length) {
        let char = input[current];

        // Handle Whitespace
        if (/\s/.test(char)) {
            let value = '';
            const startLine = line;
            const startColumn = column;

            while (current < input.length && /\s/.test(input[current])) {
                if (input[current] === '\n') {
                    line++;
                    column = 1;
                } else {
                    column++;
                }
                value += input[current];
                current++;
            }
            tokens.push({ type: TokenType.Whitespace, value, line: startLine, column: startColumn });
            continue;
        }

        // Handle Comments
        if (char === '/' && input[current + 1] === '/') {
            let value = '';
            const startLine = line;
            const startColumn = column;
            
            while (current < input.length && input[current] !== '\n') {
                value += input[current];
                current++;
                column++;
            }
            tokens.push({ type: TokenType.Comment, value, line: startLine, column: startColumn });
            continue;
        }

        if (char === '/' && input[current + 1] === '*') {
            let value = '';
            const startLine = line;
            const startColumn = column;

            value += '/*';
            current += 2;
            column += 2;

            while (current < input.length) {
                if (input[current] === '*' && input[current + 1] === '/') {
                    value += '*/';
                    current += 2;
                    column += 2;
                    break;
                }
                if (input[current] === '\n') {
                    line++;
                    column = 1;
                } else {
                    column++;
                }
                value += input[current];
                current++;
            }
            tokens.push({ type: TokenType.Comment, value, line: startLine, column: startColumn });
            continue;
        }

        // Handle Strings
        // Triple quote '''
        if (char === '\'' && input[current + 1] === '\'' && input[current + 2] === '\'') {
             let value = "'''";
             const startLine = line;
             const startColumn = column;
             current += 3;
             column += 3;

             while (current < input.length) {
                if (input[current] === '\'' && input[current + 1] === '\'' && input[current + 2] === '\'') {
                    value += "'''";
                    current += 3;
                    column += 3;
                    break;
                }
                if (input[current] === '\n') {
                    line++;
                    column = 1;
                } else {
                    column++;
                }
                value += input[current];
                current++;
             }
             tokens.push({ type: TokenType.String, value, line: startLine, column: startColumn });
             continue;
        }

        // Single quote '
        if (char === '\'') {
            let value = "'";
            const startLine = line;
            const startColumn = column;
            current++;
            column++;

            while (current < input.length) {
                // Escape sequence \' handling could be added here if needed, but for now simple check
                if (input[current] === '\\' && input[current + 1] === '\'') {
                    value += "\\'";
                    current += 2;
                    column += 2;
                    continue;
                }

                if (input[current] === '\'') {
                    value += "'";
                    current++;
                    column++;
                    break;
                }
                if (input[current] === '\n') {
                    line++;
                    column = 1;
                } else {
                    column++;
                }
                value += input[current];
                current++;
            }
            tokens.push({ type: TokenType.String, value, line: startLine, column: startColumn });
            continue;
        }

        // Double quote "
        if (char === '"') {
            let value = '"';
            const startLine = line;
            const startColumn = column;
            current++;
            column++;

            while (current < input.length) {
                 if (input[current] === '\\' && input[current + 1] === '"') {
                    value += '\\"';
                    current += 2;
                    column += 2;
                    continue;
                }

                if (input[current] === '"') {
                    value += '"';
                    current++;
                    column++;
                    break;
                }
                if (input[current] === '\n') {
                    line++;
                    column = 1;
                } else {
                    column++;
                }
                value += input[current];
                current++;
            }
            tokens.push({ type: TokenType.String, value, line: startLine, column: startColumn });
            continue;
        }


        // Handle Symbols
        if (/[\{\}\[\]\(\),:>.\-<\\]/.test(char)) {
            tokens.push({ type: TokenType.Symbol, value: char, line, column });
            current++;
            column++;
            continue;
        }

        // Handle Words (Identifiers, Keywords, Numbers, etc.)
        // We accept mostly anything that isn't whitespace or special symbols
        if (/[a-zA-Z0-9_]/.test(char)) {
             let value = '';
             const startLine = line;
             const startColumn = column;
             
             while (current < input.length && /[a-zA-Z0-9_]/.test(input[current])) {
                 value += input[current];
                 current++;
                 column++;
             }
             tokens.push({ type: TokenType.Word, value, line: startLine, column: startColumn });
             continue;
        }

        // Fallback or Unknown
        tokens.push({ type: TokenType.Unknown, value: char, line, column });
        current++;
        column++;
    }

    return tokens;
}
