# ${{ values.name }}

${{ values.description }}

Owner: `${{ values.owner }}`

## Endpoints

| Method | Path | Response |
|--------|------|----------|
| GET | `/` | 200, `{"service":"${{ values.name }}"}` |
| GET | `/healthz` | 200 |
| GET | `/readyz` | 200 |

Unknown paths return 404, other methods on known paths return 405.

## Local run

```
go run .
PORT=9090 go run .
go test -race ./...
golangci-lint run
```

The server listens on `PORT` (default `8080`) and shuts down gracefully on `SIGTERM` and `SIGINT`.

## Image

Base images come from `zot.homelab`: it needs an `/etc/hosts` entry, the `homelab-ca` certificate in `~/.docker/certs.d/zot.homelab/ca.crt` and `docker login zot.homelab`. The images are `linux/amd64`, so on Apple Silicon pass the platform explicitly:

```
docker build --platform linux/amd64 -t ${{ values.name }}:local .
docker run --rm --platform linux/amd64 --read-only --user 65532:65532 -p 8080:8080 ${{ values.name }}:local
```
