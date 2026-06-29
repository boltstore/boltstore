# Changelog

## [1.0.2] - 2026-06-30

### Fixed

- Admin UI: Fixed 16 pre-existing `vue-tsc` type errors across 6 files (missing type re-exports, `DataTable.vue` ref callback, CSS module declaration, implicit `any` params, `DatabaseInfo` missing `group` field, removed unused `t.operation` reference)
- Admin UI: Added error feedback for rename database and rename table errors — validation errors are now displayed inline instead of silently failing
