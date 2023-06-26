package sub

import (
	"testing"
)

// TestSomeFuzzTarget contains a string "Fuzz",
// but it is not a fuzz test.
func TestSomeFuzzTarget(t *testing.T) {
	SomeFuzzTarget("Hello, fuzzing!")
}

func FuzzSomeFuzzTarget(f *testing.F) {
	f.Add("Hello, fuzzing!")
	f.Fuzz(func(t *testing.T, orig string) {
		SomeFuzzTarget(orig)
	})
}
