// Command splittrust is the RFC 9704 verifier, owner tool and lab console.
package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/txtrec"
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

// recordBuildRequest is the owner-tool input: a claim plus optional DS values.
type recordBuildRequest struct {
	claim.RawClaim
	DS []string `json:"ds"`
}

func (r *recordBuildRequest) UnmarshalJSON(b []byte) error {
	if err := json.Unmarshal(b, &r.RawClaim); err != nil {
		return err
	}
	var ds struct {
		DS []string `json:"ds"`
	}
	if err := json.Unmarshal(b, &ds); err != nil {
		return err
	}
	r.DS = ds.DS
	delete(r.Extra, "ds")
	return nil
}

// recordBuild is the owner-tool output (design section 6 RecordBuild).
type recordBuild struct {
	Claim        claim.RawClaim `json:"claim"`
	RecordOwner  string         `json:"record_owner"`
	TXT          string         `json:"txt"`
	Token        string         `json:"token"`
	SigningState string         `json:"signing_state"`
	TrustContext string         `json:"trust_context"`
	Warnings     []string       `json:"warnings"`
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
	var req recordBuildRequest
	if err := json.Unmarshal(b, &req); err != nil {
		return fail(errOut, fmt.Errorf("%s: %v", *file, err))
	}
	if req.Algorithm == "" {
		req.Algorithm = "SHA384"
	}
	if strings.TrimSpace(req.Salt) == "" {
		salt := make([]byte, 32)
		if _, err := rand.Read(salt); err != nil {
			return fail(errOut, err)
		}
		req.Salt = base64.RawURLEncoding.EncodeToString(salt)
	}
	build, err := buildRecord(req)
	if err != nil {
		return fail(errOut, err)
	}
	if *asJSON {
		writeJSON(out, build)
		return exitOK
	}
	cj, _ := json.Marshal(build.Claim)
	fmt.Fprintf(out, "; publish in the %s zone (RFC 9704 section 5):\n%s 3600 IN TXT \"%s\"\n\n; announce to clients (PvD splitDnsClaims entry):\n%s\n", build.Claim.Parent, build.RecordOwner, build.TXT, cj)
	for _, w := range build.Warnings {
		fmt.Fprintln(out, "warning:", w)
	}
	return exitOK
}

func buildRecord(req recordBuildRequest) (recordBuild, error) {
	c, err := claim.Canonicalize(req.RawClaim)
	if err != nil {
		return recordBuild{}, err
	}
	ins, err := claim.InspectCanonical(c)
	if err != nil {
		return recordBuild{}, err
	}
	// The published claim uses canonical relative names so that any client computes the same token.
	published := req.RawClaim
	published.Parent = strings.TrimSuffix(c.Parent, ".")
	published.Resolver = strings.TrimSuffix(c.Resolver, ".")
	published.Subdomains = c.Relative
	published.Algorithm = c.Algorithm
	published.Salt = base64.RawURLEncoding.EncodeToString(c.Salt)
	warnings := append([]string{}, ins.Warnings...)
	warnings = append(warnings, "signing_state=not_checked: this tool did not look up whether "+c.Parent+" is DNSSEC-signed; an unsigned zone can only be verified through a device's external encrypted resolver (RFC 9704 section 6.1)")
	return recordBuild{
		Claim:        published,
		RecordOwner:  ins.RecordOwner,
		TXT:          txtrec.Format(ins.Token, req.DS),
		Token:        ins.Token,
		SigningState: "not_checked",
		TrustContext: trustContextLabel,
		Warnings:     warnings,
	}, nil
}
