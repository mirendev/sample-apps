# db-app

Sample application demonstrating a Go web service with a PostgreSQL database.

## Features

This app demonstrates:
- **Service DNS**: The app connects to PostgreSQL via `db.app.miren` - no manual IP discovery needed
- **Persistent disks**: PostgreSQL data survives across deployments using a 10GB ext4 disk
- **Service environment variables**: Database credentials configured per-service
- **Fixed-mode concurrency**: Persistent singleton database instance

## Deployment

```bash
cd testdata/db-app
miren deploy
```

That's it! The app automatically connects to the database using DNS.

## How It Works

The `app.toml` configures:

1. **Database URL** using service DNS:
   ```toml
   [[env]]
   key = "DATABASE_URL"
   value = "postgresql://go:hunter2@db.app.miren/postgres?sslmode=disable"
   ```

2. **PostgreSQL service** with credentials and persistent storage:
   ```toml
   [services.db]
   image = "oci.miren.cloud/postgres:15"

   [[services.db.env]]
   key = "POSTGRES_USER"
   value = "go"

   [[services.db.env]]
   key = "POSTGRES_PASSWORD"
   value = "hunter2"

   [[services.db.disks]]
   name = "postgres-data"
   mount_path = "/var/lib/postgresql"
   size_gb = 10
   ```

The service name `db` becomes accessible at `db.app.miren` via Miren's internal DNS.

## Testing

Once deployed, the app exposes:

- `GET /` - Shows PostgreSQL version
- `GET /health` - Health check endpoint
- `GET /data` - List all stored key-value pairs
- `POST /set?key=X&value=Y` - Store a value

## Testing Disk Persistence

Data persists across deployments:

```bash
# Store some data
curl -X POST "http://<app-url>/set?key=test&value=hello"

# Redeploy the app
miren deploy

# Data is still there
curl "http://<app-url>/data"
```
