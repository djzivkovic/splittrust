package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/djzivkovic/splittrust/internal/vectors"
)

func init() {
	register("vectors", "vectors [--out DIR]                   regenerate the published test vectors (vectors/*.json)", runVectors)
}

func runVectors(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("vectors", flag.ContinueOnError)
	fs.SetOutput(errOut)
	dir := fs.String("out", "", "write the JSON files into this directory (default: print a summary and the forensics)")
	if err := fs.Parse(args); err != nil {
		return exitInvalid
	}
	files, err := vectors.Generate()
	if err != nil {
		return fail(errOut, err)
	}
	if *dir == "" {
		f, _ := vectors.ComputeForensics()
		fmt.Fprint(out, vectors.Describe(files))
		fmt.Fprintf(out, "\nRFC 9704 section 5.1: printed token %s (%d chars, %d octets)\n  correct for the printed salt : %s\n  correct for the draft-07 salt: %s\n  draft-07 digest with the 0x00 at offset %d removed: %s  reproduces printed token: %v\n",
			f.PrintedToken, f.PrintedTokenChars, f.PrintedTokenOctets, f.CorrectTokenRFCSalt, f.CorrectTokenDraft07Salt, f.NulOffsetInDigest, f.NulStrippedToken, f.Reproduced)
		return exitOK
	}
	if err := os.MkdirAll(*dir, 0o755); err != nil {
		return fail(errOut, err)
	}
	for _, name := range vectors.FileNames(files) {
		if err := os.WriteFile(filepath.Join(*dir, name), files[name], 0o644); err != nil {
			return fail(errOut, err)
		}
	}
	fmt.Fprintf(out, "wrote %d files to %s\n", len(files), *dir)
	return exitOK
}
