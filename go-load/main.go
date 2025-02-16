package main

import (
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
)

func main() {
	var ver string
	data, err := os.ReadFile("/build-version")
	if err == nil {
		ver = strings.TrimSpace(string(data))
	} else {
		ver = "unknown"
	}

	rtVer := os.Getenv("MIREN_VERSION")
	if rtVer == "" {
		rtVer = "unknown"
	}

	name := os.Getenv("NAME")

	http.ListenAndServe(":3000", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		fmt.Fprintf(w, "name=%s\nVersions: build=%s, runtime=%s\n", name, ver, rtVer)

		if ok {
			flusher.Flush()
		}

		sc := r.URL.Query().Get("count")

		count, err := strconv.Atoi(sc)
		if err != nil {
			http.Error(w, "invalid count", http.StatusBadRequest)
			return
		}

		num := big.NewInt(1000001)
		two := big.NewInt(2)

		var primes int

		for primes < count {
			if num.ProbablyPrime(20) {
				primes++
			}

			num = num.Add(num, two)
		}

		fmt.Fprintf(w, "prime: %s\n", num.String())
		if ok {
			flusher.Flush()
		}
		fmt.Fprintf(w, "done\n")
	}))
}
