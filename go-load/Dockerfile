FROM golang:latest

ARG MIREN_VERSION

ADD . /src

RUN echo "$MIREN_VERSION" > /build-version

RUN cd /src && go build -o /app

CMD ["/app"]
