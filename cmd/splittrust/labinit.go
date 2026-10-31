package main

import (
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/djzivkovic/splittrust/internal/labgen"
)

func init() {
	register("lab-init", "lab-init --out DIR                   bootstrap only: salts, claims, TXT lines, PvD docs, local zones, manifest", runLabInit)
}

func runLabInit(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("lab-init", flag.ContinueOnError)
	fs.SetOutput(errOut)
	dir := fs.String("out", "", "output directory (the bootstrap work tree)")
	if err := fs.Parse(args); err != nil || *dir == "" {
		fs.Usage()
		return exitInvalid
	}
	if err := labgen.Generate(*dir, time.Now()); err != nil {
		return fail(errOut, err)
	}
	fmt.Fprintln(out, "lab artefacts written to", *dir)
	return exitOK
}
