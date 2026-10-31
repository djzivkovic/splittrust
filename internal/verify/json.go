package verify

import (
	"context"
	"encoding/json"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/dot"
)

func jsonUnmarshalClaims(b []byte, raws *[]claim.RawClaim) error {
	if err := json.Unmarshal(b, raws); err == nil {
		return nil
	}
	var one claim.RawClaim
	if err := json.Unmarshal(b, &one); err != nil {
		return err
	}
	*raws = []claim.RawClaim{one}
	return nil
}

// DoTAdapter adapts *dot.Client to the DoTDialer interface.
type DoTAdapter struct{ Client *dot.Client }

// Dial implements DoTDialer.
func (a DoTAdapter) Dial(ctx context.Context, addr, serverName string) (DoTConn, error) {
	c, err := a.Client.Dial(ctx, addr, serverName)
	if err != nil {
		return nil, err
	}
	return c, nil
}
