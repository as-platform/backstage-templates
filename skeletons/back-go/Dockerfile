FROM zot.homelab/golden/go-builder:stable AS build

WORKDIR /home/builder

COPY --chown=builder:builder go.mod go.sum* ./

RUN go mod download

COPY --chown=builder:builder . .

RUN go build -ldflags="-s -w" -o /home/builder/app .

FROM zot.homelab/golden/runtime:go

COPY --from=build /home/builder/app /app

EXPOSE 8080

USER 65532:65532

ENTRYPOINT ["/app"]
