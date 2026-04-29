import { PublicKey } from "@solana/web3.js";
import { LABEL_LENGTH } from "./constants.js";
import type { PublicKeyish, U64Input } from "./types.js";

export function toPublicKey(value: PublicKeyish): PublicKey {
  if (value instanceof PublicKey) {
    return value;
  }
  if (typeof value === "object" && value !== null && "toBase58" in value && typeof value.toBase58 === "function") {
    return new PublicKey(value.toBase58());
  }
  return new PublicKey(value);
}

export function u8(value: number, label = "u8 value"): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${label} out of range`);
  }
  return value;
}

export function u16Le(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError("u16 value out of range");
  }
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

export function u32Le(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError("u32 value out of range");
  }
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

export function u64Le(value: U64Input): Buffer {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError("u64 number input must be a non-negative safe integer; use bigint or string for large values");
  }
  const bigint = typeof value === "bigint" ? value : BigInt(value);
  if (bigint < 0n || bigint > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("u64 value out of range");
  }
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(bigint, 0);
  return out;
}

export function encodeLabel(label: string | Uint8Array = ""): Buffer {
  if (typeof label === "string" && label.includes("\0")) {
    throw new RangeError("label string must not contain NUL bytes");
  }
  const bytes = typeof label === "string" ? Buffer.from(label, "utf8") : Buffer.from(label);
  if (bytes.length > LABEL_LENGTH) {
    throw new RangeError(`label must fit in ${LABEL_LENGTH} bytes`);
  }
  const nul = bytes.indexOf(0);
  if (nul !== -1 && bytes.subarray(nul).some((byte) => byte !== 0)) {
    throw new RangeError("label bytes must not contain nonzero bytes after the first NUL");
  }
  const out = Buffer.alloc(LABEL_LENGTH);
  bytes.copy(out);
  return out;
}

export function decodeLabel(bytes: Uint8Array): string {
  const nul = bytes.indexOf(0);
  const end = nul === -1 ? bytes.length : nul;
  return Buffer.from(bytes.slice(0, end)).toString("utf8");
}

export function concatData(tag: number, ...parts: Uint8Array[]): Buffer {
  return Buffer.concat([Buffer.from([tag]), ...parts.map((part) => Buffer.from(part))]);
}
