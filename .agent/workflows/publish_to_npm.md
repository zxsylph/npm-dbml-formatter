---
description: How to publish the package to NPM
---

# Publishing to NPM

Follow these steps to publish your `dbml_formatter` tool to the NPM registry.

## 1. Prepare the Package

1.  **Check Package Name**: The name `dbml-extension` might be taken. You should check [npmjs.com](https://www.npmjs.com/) or change `"name"` in `package.json` to something unique (e.g., `@your-username/dbml-formatter` or `dbml-fmt-cli`).
2.  **Update Version**: Ensure `"version"` in `package.json` is correct (e.g., `1.0.0` for initial release).
3.  **Clean Dependencies**: Since we are using `ts-node` at runtime, ensuring `typescript` and `ts-node` are in `"dependencies"` (which they are) is correct for this setup.

## 2. Authenticate

Run the following command to log in to your NPM account:

```bash
npm login
```

## 3. Publish

Run the publish command:

```bash
npm publish
```

If you are using a scoped name (like `@user/pkg`), use:

```bash
npm publish --access public
```

## 4. Usage After Publishing

Once published, anyone can run your tool using `npx`:

```bash
npx [your-package-name] <file.dbml>
```

If you named it `dbml-extension`, they would run `npx dbml-extension <file>`.
If you want the command to be `npx dbml_formatter`, you should name the package `dbml_formatter` (if available), OR users can run:

```bash
npx -p [your-package-name] dbml_formatter <file>
```
