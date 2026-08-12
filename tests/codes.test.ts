import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  codeHint,
  formatCode,
  generateCode,
  hashCode,
  hashesEqual,
  normalizeCode,
} from "@/lib/auth/codes";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const PEPPER = "test-pepper";

describe("generateCode", () => {
  it("produces 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCode();
      assert.equal(code.length, 8);
      for (const char of code) {
        assert.ok(ALPHABET.includes(char), `unexpected character ${char}`);
      }
    }
  });

  it("never emits a lookalike character", () => {
    // The whole point of the custom alphabet: these must not appear on a printed card.
    const banned = ["0", "1", "I", "L", "O", "U"];
    const sample = Array.from({ length: 500 }, generateCode).join("");
    for (const char of banned) {
      assert.ok(!sample.includes(char), `alphabet leaked ${char}`);
    }
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 2000 }, generateCode));
    assert.equal(codes.size, 2000);
  });

  it("distributes characters roughly evenly", () => {
    // Guards the rejection sampling: a naive `byte % 30` would over-represent the
    // first 16 characters by ~7%.
    const counts = new Map<string, number>();
    const sample = Array.from({ length: 5000 }, generateCode).join("");
    for (const char of sample) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    const expected = sample.length / ALPHABET.length;
    for (const char of ALPHABET) {
      const count = counts.get(char) ?? 0;
      assert.ok(
        Math.abs(count - expected) < expected * 0.2,
        `${char} appeared ${count} times, expected ~${expected}`,
      );
    }
  });
});

describe("normalizeCode", () => {
  it("accepts what a judge would plausibly type", () => {
    assert.equal(normalizeCode("K7M2Q9XR"), "K7M2Q9XR");
    assert.equal(normalizeCode("k7m2q9xr"), "K7M2Q9XR");
    assert.equal(normalizeCode("K7M2-Q9XR"), "K7M2Q9XR");
    assert.equal(normalizeCode("k7m2 q9xr"), "K7M2Q9XR");
    assert.equal(normalizeCode("  K7M2-Q9XR  "), "K7M2Q9XR");
  });

  it("rejects malformed input rather than passing it to the database", () => {
    assert.equal(normalizeCode(""), null);
    assert.equal(normalizeCode("K7M2Q9X"), null); // too short
    assert.equal(normalizeCode("K7M2Q9XRR"), null); // too long
    assert.equal(normalizeCode("K7M2Q9X!"), null); // stripped, then too short
  });

  it("rejects characters outside the alphabet", () => {
    for (const banned of ["0", "1", "I", "L", "O", "U"]) {
      assert.equal(normalizeCode(`K7M2Q9X${banned}`), null, `accepted ${banned}`);
    }
  });

  it("round-trips every generated code", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      assert.equal(normalizeCode(formatCode(code)), code);
      assert.equal(normalizeCode(formatCode(code).toLowerCase()), code);
    }
  });
});

describe("formatCode / codeHint", () => {
  it("splits into two readable groups", () => {
    assert.equal(formatCode("K7M2Q9XR"), "K7M2-Q9XR");
  });

  it("hints with the last four characters", () => {
    assert.equal(codeHint("K7M2Q9XR"), "Q9XR");
  });
});

describe("hashCode", () => {
  it("is deterministic", () => {
    assert.equal(hashCode("K7M2Q9XR", PEPPER), hashCode("K7M2Q9XR", PEPPER));
  });

  it("produces a 64-character hex digest", () => {
    assert.match(hashCode("K7M2Q9XR", PEPPER), /^[0-9a-f]{64}$/);
  });

  it("depends on the pepper", () => {
    // Rotating JUDGE_CODE_PEPPER must invalidate every existing code.
    assert.notEqual(hashCode("K7M2Q9XR", PEPPER), hashCode("K7M2Q9XR", "other"));
  });

  it("separates distinct codes", () => {
    assert.notEqual(hashCode("K7M2Q9XR", PEPPER), hashCode("K7M2Q9XS", PEPPER));
  });
});

describe("hashesEqual", () => {
  it("compares equal and unequal digests", () => {
    const a = hashCode("K7M2Q9XR", PEPPER);
    const b = hashCode("K7M2Q9XS", PEPPER);
    assert.ok(hashesEqual(a, a));
    assert.ok(!hashesEqual(a, b));
  });

  it("returns false for malformed or empty input instead of throwing", () => {
    const a = hashCode("K7M2Q9XR", PEPPER);
    assert.ok(!hashesEqual(a, ""));
    assert.ok(!hashesEqual("", ""));
    assert.ok(!hashesEqual(a, "abcd"));
  });
});
