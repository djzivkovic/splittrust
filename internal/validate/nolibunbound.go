//go:build !libunbound

package validate

import "errors"

// Backend reports the validator implementation compiled into this binary.
func Backend() string { return "none (built without -tags libunbound)" }

// New fails: DNSSEC validation needs libunbound. The lab image is always built
// with -tags libunbound; this stub only keeps the pure packages and their tests
// buildable on hosts without the library.
func New(cfg Config) (PublicResolver, error) {
	_ = cfg
	return nil, errors.New("validate: this binary was built without libunbound; build with -tags libunbound (see lab/app/Dockerfile)")
}
