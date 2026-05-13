# e2e/

Playwright end-to-end and API tests, organized by session tag.

## Structure

```
e2e/
  session-01/   ← scaffold smoke tests (this session)
  session-04/   ← seed corpus and asset count API tests
  session-05/   ← git and document ingest API tests
  session-08b/  ← project and asset lifecycle UI tests
  session-08c/  ← external curation API tests
  ...
```

## Running tests

```bash
# All E2E tests
npx playwright test

# Single session
npx playwright test e2e/session-01/

# API tests only (headless, no browser needed)
npx playwright test --project=chromium --grep @api
```

## Writing tests

- Browser E2E tests use `@playwright/test` with the `page` fixture.
- API-only tests use `request` context and can be tagged `@api`.
- At least one test per session must cover the primary happy path.
