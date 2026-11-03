#!/bin/sh
# Migrations run before the server accepts a request, so a deploy can never
# serve a build against a schema it does not have. Set RUN_MIGRATIONS=false
# to take that out of the container's hands (a release step of your own).
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ] && [ -n "$DATABASE_URL" ]; then
  echo "payus: applying migrations"
  node /app/web/scripts/migrate.mjs
fi

exec "$@"
