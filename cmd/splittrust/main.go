// Command splittrust is the RFC 9704 verifier, owner tool and lab console.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/owner"
)

// Exit codes (design section 6).
const (
	exitOK            = 0
	exitRejected      = 1
	exitInvalid       = 2
	trustContextLabel = "lab"
)

type command struct {
	run  func(args []string, out, errOut io.Writer) int
	help string
}

var commands = map[string]command{}

func register(name, help string, run func(args []string, out, errOut io.Writer) int) {
	commands[name] = command{run: run, help: help}
}

func init() {
	register("inspect", "inspect --claim FILE [--json]        compute canonical form, token and record owner (no network)", runInspect)
	register("build-record", "build-record --input FILE [--json]  owner tool: claim JSON + Verification Record TXT line", runBuildRecord)
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, out, errOut io.Writer) int {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		usage(errOut)
		return exitInvalid
	}
	c, ok := commands[args[0]]
	if !ok {
		fmt.Fprintf(errOut, "unknown command %q\n", args[0])
		usage(errOut)
		return exitInvalid
	}
	return c.run(args[1:], out, errOut)
}

func usage(w io.Writer) {
	fmt.Fprintln(w, "splittrust — RFC 9704 split-horizon authority verifier (trust_context="+trustContextLabel+")")
	fmt.Fprintln(w, "usage: splittrust <command> [flags]")
	names := make([]string, 0, len(commands))
	for n := range commands {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		fmt.Fprintln(w, "  "+commands[n].help)
	}
}

func readClaimFile(path string) (claim.RawClaim, error) {
	var raw claim.RawClaim
	b, err := os.ReadFile(path)
	if err != nil {
		return raw, err
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return raw, fmt.Errorf("%s: %v", path, err)
	}
	return raw, nil
}

func writeJSON(w io.Writer, v any) {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func fail(errOut io.Writer, err error) int {
	var ce *claim.Error
	if errors.As(err, &ce) {
		fmt.Fprintf(errOut, "%s: %s\n", ce.Code, ce.Detail)
		return exitInvalid
	}
	fmt.Fprintln(errOut, "error:", err)
	return exitInvalid
}

func runInspect(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("inspect", flag.ContinueOnError)
	fs.SetOutput(errOut)
	file := fs.String("claim", "", "claim JSON file (RFC 9704 section 5.2.2 shape)")
	asJSON := fs.Bool("json", false, "print one JSON object on stdout")
	if err := fs.Parse(args); err != nil || *file == "" {
		fs.Usage()
		return exitInvalid
	}
	raw, err := readClaimFile(*file)
	if err != nil {
		return fail(errOut, err)
	}
	ins, err := claim.Inspect(raw)
	if err != nil {
		return fail(errOut, err)
	}
	if *asJSON {
		writeJSON(out, ins)
		return exitOK
	}
	fmt.Fprintf(out, "resolver (ADN)   %s\nparent           %s\nsubdomains       %s\nscopes           %s\nalgorithm        %s  salt %d octets\n$X               %s\ntoken input      %s\ntoken            %s\nrecord owner     %s\n",
		ins.CanonicalResolver, ins.CanonicalParent, strings.Join(ins.Relative, ", "), strings.Join(ins.Scopes, ", "),
		ins.Algorithm, ins.SaltLength, ins.PseudoWireHex, ins.TokenInputHex, ins.Token, ins.RecordOwner)
	for _, w := range ins.Warnings {
		fmt.Fprintln(out, "warning:", w)
	}
	return exitOK
}

func runBuildRecord(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("build-record", flag.ContinueOnError)
	fs.SetOutput(errOut)
	file := fs.String("input", "", "JSON file: resolver, parent, subdomains, algorithm, optional salt (base64url), optional ds array")
	asJSON := fs.Bool("json", false, "print one JSON object on stdout")
	if err := fs.Parse(args); err != nil || *file == "" {
		fs.Usage()
		return exitInvalid
	}
	b, err := os.ReadFile(*file)
	if err != nil {
		return fail(errOut, err)
	}
	var req owner.Request
	if err := json.Unmarshal(b, &req); err != nil {
		return fail(errOut, fmt.Errorf("%s: %v", *file, err))
	}
	build, err := owner.Make(req)
	if err != nil {
		return fail(errOut, err)
	}
	if *asJSON {
		writeJSON(out, build)
		return exitOK
	}
	cj, _ := json.Marshal(build.Claim)
	fmt.Fprintf(out, "; publish in the %s zone (RFC 9704 section 5):\n%s\n\n; announce to clients (PvD splitDnsClaims entry):\n%s\n", build.Claim.Parent, build.ZoneLine, cj)
	for _, w := range build.Warnings {
		fmt.Fprintln(out, "warning:", w)
	}
	return exitOK
}
