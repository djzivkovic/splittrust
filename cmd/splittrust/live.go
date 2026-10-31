package main

import (
	"context"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/dhcp"
	"github.com/djzivkovic/splittrust/internal/engine"
	"github.com/djzivkovic/splittrust/internal/route"
	"github.com/djzivkovic/splittrust/internal/verify"
)

func init() {
	register("verify", "verify --scenario ID | --claim FILE [--device D] [--resolution R] [--json]   verify a network's claim(s) as the simulated device", runVerify)
	register("resolve", "resolve --scenario ID --name FQDN [--device D] [--json]    resolve a name the way the device would after verification", runResolve)
	register("scenarios", "scenarios [--json]                    list lab scenarios with expected outcomes", runScenarios)
	register("dhcp", "dhcp encode --claim FILE | decode HEX  RFC 9704 section 5.2.1 DHCP Authentication option payload", runDHCP)
}

func manifestPath() string {
	if p := os.Getenv("SPLITTRUST_MANIFEST"); p != "" {
		return p
	}
	return "/gen/client/manifest.json"
}

func loadEngine(errOut io.Writer) (*engine.Engine, int) {
	e, err := engine.Load(manifestPath())
	if err != nil {
		fmt.Fprintf(errOut, "cannot load the lab manifest (%s): %v\nRun inside the lab (docker compose exec app …) or set SPLITTRUST_MANIFEST.\n", manifestPath(), err)
		return nil, exitInvalid
	}
	return e, exitOK
}

func deviceFlags(fs *flag.FlagSet) (*string, *string) {
	d := fs.String("device", "", "simulated device: validating-stub | private-dns | hybrid (default: the scenario's default)")
	r := fs.String("resolution", "via-network", "how a validating device resolves: via-network | iterative")
	return d, r
}

func options(device, resolution string) (verify.Options, error) {
	opt := verify.Options{Device: verify.Device(device), Resolution: verify.Resolution(resolution)}
	switch opt.Device {
	case "", verify.DeviceValidatingStub, verify.DevicePrivateDNS, verify.DeviceHybrid:
	default:
		return opt, fmt.Errorf("unknown device %q", device)
	}
	switch opt.Resolution {
	case verify.ViaNetwork, verify.Iterative:
	default:
		return opt, fmt.Errorf("unknown resolution %q", resolution)
	}
	return opt, nil
}

func exitFor(decision string) int {
	switch decision {
	case "accepted":
		return exitOK
	case "rejected":
		return exitRejected
	}
	return exitInvalid
}

func runVerify(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("verify", flag.ContinueOnError)
	fs.SetOutput(errOut)
	scenario := fs.String("scenario", "", "scenario id (see `splittrust scenarios`)")
	claimFile := fs.String("claim", "", "verify this claim file instead of the scenario's PvD document (uses the scenario's network profile, default legit)")
	device, resolution := deviceFlags(fs)
	asJSON := fs.Bool("json", false, "print one JSON object on stdout")
	if err := fs.Parse(args); err != nil || (*scenario == "" && *claimFile == "") {
		fs.Usage()
		return exitInvalid
	}
	opt, err := options(*device, *resolution)
	if err != nil {
		return fail(errOut, err)
	}
	e, code := loadEngine(errOut)
	if e == nil {
		return code
	}
	var inline *claim.RawClaim
	if *claimFile != "" {
		raw, err := readClaimFile(*claimFile)
		if err != nil {
			return fail(errOut, err)
		}
		inline = &raw
		if *scenario == "" {
			*scenario = engine.InlineProfileID
		}
	}
	run, err := e.Verify(context.Background(), *scenario, inline, opt)
	if err != nil {
		return fail(errOut, err)
	}
	if *asJSON {
		writeJSON(out, run)
	} else {
		printRun(out, run)
	}
	return exitFor(run.Decision)
}

func printRun(out io.Writer, run verify.Run) {
	fmt.Fprintf(out, "scenario %s  device=%s  resolution=%s  trust_context=%s\n", run.ScenarioID, run.Device, run.Resolution, run.TrustContext)
	for _, c := range run.Claims {
		fmt.Fprintf(out, "\nclaim %d: resolver %s\n", c.Index+1, c.Resolver)
		if c.Inspection != nil {
			fmt.Fprintf(out, "  scopes %s\n", strings.Join(c.Inspection.Scopes, ", "))
		}
		for _, s := range c.Stages {
			fmt.Fprintf(out, "  [%-7s] %-18s %s%s\n", s.Status, s.ID, s.Code, optionalMsg(s))
		}
		fmt.Fprintf(out, "  => %s %s\n", strings.ToUpper(c.Decision), c.Reason)
		if c.Grant != nil {
			fmt.Fprintf(out, "     %s may answer for %s until %s (path %s, local DNSSEC %s)\n", c.Grant.Resolver, strings.Join(c.Grant.Scopes, ", "), c.Grant.ExpiresAt.Format("15:04:05Z"), c.Grant.Path, c.Grant.LocalDNSSECMode)
		}
	}
	fmt.Fprintf(out, "\n%s (device=%s, trust_context=%s)\n", strings.ToUpper(run.Decision), run.Device, run.TrustContext)
}

func optionalMsg(s verify.Stage) string {
	if s.Message == "" {
		return ""
	}
	return "  " + s.Message
}

func runResolve(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("resolve", flag.ContinueOnError)
	fs.SetOutput(errOut)
	scenario := fs.String("scenario", "", "scenario id")
	name := fs.String("name", "", "name to resolve (type A)")
	device, resolution := deviceFlags(fs)
	asJSON := fs.Bool("json", false, "print one JSON object on stdout")
	if err := fs.Parse(args); err != nil || *scenario == "" || *name == "" {
		fs.Usage()
		return exitInvalid
	}
	opt, err := options(*device, *resolution)
	if err != nil {
		return fail(errOut, err)
	}
	e, code := loadEngine(errOut)
	if e == nil {
		return code
	}
	rep, err := e.Resolve(context.Background(), *scenario, *name, opt)
	if err != nil {
		return fail(errOut, err)
	}
	if *asJSON {
		writeJSON(out, rep)
	} else {
		printResolve(out, rep)
	}
	if rep.ErrorCode != "" {
		return exitRejected
	}
	return exitOK
}

func printResolve(out io.Writer, rep route.Report) {
	fmt.Fprintf(out, "%s A  device=%s  route=%s (%s)\n", rep.QName, rep.Device, rep.Route, rep.RouteReason)
	if rep.Via != "" {
		fmt.Fprintf(out, "  via      %s\n", rep.Via)
	}
	if rep.Verification != nil {
		fmt.Fprintf(out, "  claim    %s", rep.Verification.Decision)
		for _, c := range rep.Verification.Claims {
			fmt.Fprintf(out, " [%s: %s]", c.Resolver, c.Reason)
		}
		fmt.Fprintln(out)
	}
	if rep.Security != "" {
		fmt.Fprintf(out, "  security %s\n", rep.Security)
	}
	if rep.ErrorCode != "" {
		fmt.Fprintf(out, "  NO ANSWER %s: %s\n", rep.ErrorCode, rep.Error)
	} else {
		fmt.Fprintf(out, "  answers  %s\n", strings.Join(rep.Answers, ", "))
	}
}

func runScenarios(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("scenarios", flag.ContinueOnError)
	fs.SetOutput(errOut)
	asJSON := fs.Bool("json", false, "print JSON")
	if err := fs.Parse(args); err != nil {
		return exitInvalid
	}
	e, code := loadEngine(errOut)
	if e == nil {
		return code
	}
	sums := e.Manifest.Summaries()
	if *asJSON {
		writeJSON(out, sums)
		return exitOK
	}
	for _, s := range sums {
		fmt.Fprintf(out, "%-22s %s\n", s.ID, s.Title)
		for _, x := range s.Expected {
			fmt.Fprintf(out, "%-22s   %-16s expected %s / %s\n", "", x.Device, x.Decision, x.Reason)
		}
	}
	return exitOK
}

func runDHCP(args []string, out, errOut io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(errOut, "usage: splittrust dhcp encode --claim FILE [--replay N] | decode HEX")
		return exitInvalid
	}
	switch args[0] {
	case "encode":
		fs := flag.NewFlagSet("dhcp encode", flag.ContinueOnError)
		fs.SetOutput(errOut)
		file := fs.String("claim", "", "claim JSON file")
		replay := fs.Uint64("replay", 0, "64-bit replay detection value (RDM 0: strictly increasing, e.g. an NTP timestamp)")
		if err := fs.Parse(args[1:]); err != nil || *file == "" {
			fs.Usage()
			return exitInvalid
		}
		raw, err := readClaimFile(*file)
		if err != nil {
			return fail(errOut, err)
		}
		c, err := claim.Canonicalize(raw)
		if err != nil {
			return fail(errOut, err)
		}
		payload, err := dhcp.EncodeV4(c, *replay)
		if err != nil {
			return fail(errOut, err)
		}
		fmt.Fprintf(out, "option 90 / option 11 payload (%d octets, protocol 4):\n%s\n", len(payload), hex.EncodeToString(payload))
		if chunks := dhcp.SplitV4(payload); len(chunks) > 1 {
			fmt.Fprintf(out, "DHCPv4 needs RFC 3396 splitting into %d option instances\n", len(chunks))
		}
		return exitOK
	case "decode":
		if len(args) != 2 {
			fmt.Fprintln(errOut, "usage: splittrust dhcp decode HEX")
			return exitInvalid
		}
		b, err := hex.DecodeString(strings.ReplaceAll(args[1], ":", ""))
		if err != nil {
			return fail(errOut, err)
		}
		d, err := dhcp.Decode(b)
		if err != nil {
			return fail(errOut, err)
		}
		writeJSON(out, d)
		return exitOK
	}
	return fail(errOut, errors.New("unknown dhcp subcommand "+args[0]))
}
