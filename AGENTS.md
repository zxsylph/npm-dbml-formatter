# AGENTS.md

Notes for AI agents (and humans) working in this repo.

## What this is

`@zxsylph/dbml-formatter` — a small npm CLI that formats [DBML](https://dbml.dbdiagram.io/home/) schema files. It normalizes indentation, vertically aligns field types and `[...]` settings, hoists table-level notes to the top, optionally sorts fields, and can stub in empty `Note: ""` for tables/fields that lack one. Distributed via npm and run with `npx @zxsylph/dbml-formatter ...`.

The formatter is **token-based**, not AST-based. It does not depend on `@dbml/core` for formatting (only the unused `experiment.ts` does); the real implementation tokenizes the input and rewrites whitespace around the original tokens. This is intentional — it preserves comments and unusual constructs the parser would drop.

## Repo layout

| Path                         | What's there                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `bin/dbml-formatter`         | Node shebang that boots `ts-node` and runs `src/cli.ts`. This is the `bin` entry in `package.json`.       |
| `src/cli.ts`                 | Argument parsing, single-file vs `--folder` mode, dry-run, recursive `.dbml` discovery.                   |
| `src/formatter/tokenizer.ts` | Hand-written tokenizer. Emits `Whitespace | Comment | String | Symbol | Word | Unknown` tokens with line/column. |
| `src/formatter/formatter.ts` | The actual formatter. Walks tokens, buffers `Table { ... }` blocks, splits into logical lines, aligns columns, prints. ~1.4k lines. |
| `src/experiment.ts`          | Throwaway: roundtrips a sample through `@dbml/core` `importer`/`exporter`. Not part of the CLI.           |
| `src/test_*.ts`, `src/repro_*.ts` | Ad-hoc scripts run with `ts-node` for manual debugging. There is no test runner. |
| `sample-dbml/`               | Inputs used to eyeball formatter behavior (real-world-ish + intentionally messy variants).                |
| `test-dbml/`                 | Empty scratch directory (gitignored contents) for trying `--folder` against.                              |
| `tsconfig.json`              | `target: es2018`, `module: commonjs`, `strict: true`, `rootDir: ./src`, `outDir: ./dist`.                 |

`dist/` is **not** committed and **not** shipped — the package publishes raw `src/` + `tsconfig.json` and runs through `ts-node` at invocation time (see `bin/dbml-formatter`). The `files` array in `package.json` is the source of truth for what npm publishes: `bin`, `src`, `tsconfig.json`.

## How it runs

```bash
npx @zxsylph/dbml-formatter schema.dbml                 # single file → stdout
npx @zxsylph/dbml-formatter --folder ./db               # rewrite all *.dbml in place, recursive
npx @zxsylph/dbml-formatter --folder ./db --dry-run     # print diffs to console, don't write
npx @zxsylph/dbml-formatter --folder ./db --order-field # alphabetize fields within blank-line-separated groups
npx @zxsylph/dbml-formatter --folder ./db --add-note    # insert empty `Note: ""` where missing
```

Flags are positional-or-anywhere; `cli.ts` does `args.indexOf(...)` lookups. Single-file mode prints to stdout; folder mode writes files in place (or prints under `--dry-run`).

### Local development

There are no `npm test` / `npm run build` scripts. To work on the formatter:

```bash
# Run the CLI from source
./bin/dbml-formatter sample-dbml/sample.dbml

# Or via ts-node directly on the manual repro scripts
npx ts-node src/test_formatter.ts
npx ts-node src/repro_alignment.ts
```

Several `repro_*.ts` scripts hard-code a path like `../sample.dbml` or `../test_folder/...` from `__dirname`. Those paths **do not exist in this repo** — they were author-local. If you want to use one, point it at something in `sample-dbml/` first.

## How the formatter is structured

`format(input, options)` in `src/formatter/formatter.ts`:

1. **Tokenize** the whole input with `tokenize()`. Tokens carry their original source line/column and verbatim value (whitespace and comments included).
2. **Linear walk** over tokens emitting them to an `output` string, tracking `indentLevel`.
3. **On `{` after a `Table` keyword**, enter **buffer mode**: collect every token up to the matching `}`, split into "logical lines" (groups terminated by a newline while bracket depth `[`/`{` is 0), then:
   - Pull out the table-level `Note: ...` line and emit it first (with a blank line after).
   - Optionally sort field lines within each blank-line-separated block (`--order-field`).
   - Transform `[setting1, setting2, ...]` payloads (re-order / re-pack).
   - Compute column widths for field name, type, and settings across each block, then pad with `padRight` on tokens so they align vertically.
   - Emit field lines with `processTokens(...)`.
4. **Outside Table blocks**, tokens pass through with light whitespace normalization (collapses extra blank lines, ensures an empty line after a `}`).

Other block types (`Ref`, `Enum`, `TableGroup`, project-level `Note`) currently fall through the non-Table path — they are reformatted only superficially.

The `Table` keyword check is **case-insensitive and prefix-based** (`t.value.toLowerCase().startsWith('table')`), so `TableGroup` and similar will be misidentified as a table — keep this in mind when touching the lookahead in `formatter.ts:42-49`.

## Conventions to preserve when editing

- **No new dependencies for formatting logic.** The formatter is deliberately tokenizer-only. If you find yourself reaching for `@dbml/core`'s parser, stop — the choice to roll our own was to keep comments and oddball input intact.
- **Don't reformat the formatter's whitespace style mechanically.** The source uses 4-space indentation with a mix of styles; matching the surrounding block is fine, but a wholesale reformat would balloon the diff.
- **`ts-node` at runtime is intentional.** The CLI is shipped as source. Don't add a `prepublishOnly` build step or switch to a compiled `dist/` without a reason — it changes how the package boots.
- **Bump version manually.** Releases are tagged with bare `1.0.x` commits (see `git log`); there is no release script. After meaningful changes, bump `package.json` `version` and commit as the version string.
- **Sample files are fixtures.** Files in `sample-dbml/` (including the deliberately messy ones and the one with a trailing space in its name: `asset_book_current .dbml`) are used to eyeball output. Don't "fix" their names or contents.

## Caveats / known gotchas

- **No automated tests.** The `test` script in `package.json` is the npm default `echo "Error: no test specified" && exit 1`. The `test_*.ts` and `repro_*.ts` scripts are run by hand and print to stdout — there is no pass/fail wiring. Changes to `formatter.ts` need to be eyeballed against `sample-dbml/`.
- **`repro_*.ts` paths are broken.** `repro_field_issue.ts` and `repro_issue.ts` read from `../test_folder/...` which is not in the repo. `repro_alignment.ts` and `test_formatter.ts`/`test_tokenizer.ts` read from `../sample.dbml` (also missing — the samples live in `sample-dbml/`).
- **`--folder` writes in place with no backup.** Always run `--dry-run` first against unfamiliar input. There is no `.bak` or git-aware safety.
- **Table-keyword detection is loose** (`startsWith('table')`). `TableGroup { ... }` will enter buffer mode as if it were a `Table`, which is probably wrong but is the current behavior — many real DBML files don't use `TableGroup`, so it has been a non-issue.
- **`@types/node` is a runtime dep, not a devDep.** Because the package ships TypeScript source and compiles at install/run via `ts-node`, the type packages have to be available on the consumer's machine, hence the dependency-list placement.

## Recent direction

Recent commits (`git log`) show iteration on alignment correctness and on data-type quoting (`refactor: improve field type formatting by unquoting identifiers and quoting data types`, `feat: broaden table keyword recognition`, `style: Ensure an empty line after block closing braces`). When changing alignment or quoting behavior, run the existing `sample-dbml/*.dbml` files through and diff visually — that's the only regression net.

<!-- last-updated: 2026-06-10T13:26:47+07:00 commit: 510bf08 -->
