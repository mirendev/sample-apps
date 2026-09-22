FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -o /tailnet-hello .

FROM alpine:3.24
RUN apk add --no-cache ca-certificates
COPY --from=docker.io/tailscale/tailscale:stable /usr/local/bin/tailscaled /usr/local/bin/tailscale /usr/local/bin/
COPY --from=build /tailnet-hello /usr/local/bin/tailnet-hello
COPY start.sh /start.sh
CMD ["/start.sh"]
