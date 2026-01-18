# Librarian Project Agent Notes

This file contains rules specifically for developing and maintaining the Librarian core codebase.

## Developer Rules
- **Database Architecture**: Local data lives in `~/.cache/librarian/index.sqlite` and library-specific DBs in `~/.cache/librarian/db/`.
- **CLI Output**: If you change CLI output, maintain error formatting as red "Error: …".
- **Testing**: Before submitting changes, run `bun test`.
- **Commits**: Use conventional commits (e.g., `feat:`, `fix:`, `chore:`).
- **Tool Access**: The built-in MCP server provides read-only access to `search`, `library`, and `get` tools.

## Development Tasks
- **Migrations**: Add new schema changes to `src/store/migrations/index/`.
- **Web Ingest**: New web source flags must be added to `src/cli/flags.ts` and `src/cli/source/web.ts`.
