// @vitest-environment node

import { profileSigningSeed } from "../src/lib/derive";
import {
  assertPin,
  DEFAULT_KDF,
  decryptMaster,
  deriveMasterFromPrf,
  deserializeEscrow,
  encryptMaster,
  randomMaster,
  rotateEscrow,
  serializeEscrow,
  verifyEscrowPin,
} from "../src/lib/keys";
import { BadPinError } from "../src/lib/pin-errors";
import { signingPubkeyHex } from "../src/lib/signing";

const PRF = new Uint8Array(32).fill(0x11);

describe("assertPin", () => {
  it("accepts exactly 6 digits", () => {
    expect(() => assertPin("012345")).not.toThrow();
  });
  it("rejects non-6-digit inputs", () => {
    for (const bad of ["12345", "1234567", "12a456", "", "abcdef"]) {
      expect(() => assertPin(bad)).toThrow();
    }
  });
});

describe("deriveMasterFromPrf", () => {
  it("is deterministic for the same PRF + PIN", () => {
    expect(deriveMasterFromPrf(PRF, "123456")).toEqual(
      deriveMasterFromPrf(PRF, "123456"),
    );
  });

  it("changes if either factor changes (both are required)", () => {
    const base = deriveMasterFromPrf(PRF, "123456");
    const otherPin = deriveMasterFromPrf(PRF, "654321");
    const otherPrf = deriveMasterFromPrf(
      new Uint8Array(32).fill(0x22),
      "123456",
    );
    expect(otherPin).not.toEqual(base);
    expect(otherPrf).not.toEqual(base);
  });
});

describe("escrow round-trip", () => {
  // Argon2id is intentionally slow; give it headroom.
  it("decrypts with the correct PIN and fails with a wrong PIN", () => {
    const master = randomMaster();
    const blob = encryptMaster(master, "246810", DEFAULT_KDF);

    expect(decryptMaster(blob, "246810")).toEqual(master);
    expect(() => decryptMaster(blob, "999999")).toThrow();
  }, 20_000);

  it("survives hex transport across the tRPC boundary", () => {
    const master = randomMaster();
    const blob = encryptMaster(master, "135790", DEFAULT_KDF);
    const wire = serializeEscrow(blob);

    // Wire shape is JSON-safe (hex strings + structured params).
    expect(wire.encryptedMasterHex).toMatch(/^[0-9a-f]+$/);
    expect(wire.masterSaltHex).toMatch(/^[0-9a-f]+$/);
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);

    const restored = deserializeEscrow(wire);
    expect(restored.ciphertext).toEqual(blob.ciphertext);
    expect(restored.salt).toEqual(blob.salt);
    expect(restored.params).toEqual(blob.params);
    expect(decryptMaster(restored, "135790")).toEqual(master);
  }, 20_000);
});

describe("escrow rotation", () => {
  it("verifies a PIN without exposing the decrypted master", () => {
    const current = serializeEscrow(encryptMaster(randomMaster(), "123456"));
    expect(() => verifyEscrowPin(current, "123456")).not.toThrow();
    expect(() => verifyEscrowPin(current, "654321")).toThrow(BadPinError);
  }, 20_000);

  it("re-wraps the same master with fresh salt and ciphertext", () => {
    const master = randomMaster();
    const current = serializeEscrow(encryptMaster(master, "123456"));
    const before = signingPubkeyHex(profileSigningSeed(master));

    const rotated = rotateEscrow(current, "123456", "654321");
    const recovered = decryptMaster(deserializeEscrow(rotated), "654321");

    expect(recovered).toEqual(master);
    expect(signingPubkeyHex(profileSigningSeed(recovered))).toBe(before);
    expect(rotated.masterSaltHex).not.toBe(current.masterSaltHex);
    expect(rotated.encryptedMasterHex).not.toBe(current.encryptedMasterHex);
    expect(() => decryptMaster(deserializeEscrow(rotated), "123456")).toThrow();
  }, 30_000);

  it("turns an authentication failure into BadPinError", () => {
    const current = serializeEscrow(encryptMaster(randomMaster(), "123456"));
    expect(() => rotateEscrow(current, "000000", "654321")).toThrow(
      BadPinError,
    );
  }, 20_000);
});
