import type { DecimalAmountInput } from "./types.js";

export const SOL_DECIMALS = 9;

const MAX_U64 = 0xffff_ffff_ffff_ffffn;

export function solToLamports(sol: DecimalAmountInput): bigint {
  return decimalToBaseUnits(sol, SOL_DECIMALS, "sol");
}

export function tokensToBaseUnits(tokens: DecimalAmountInput, decimals: number): bigint {
  return decimalToBaseUnits(tokens, decimals, "tokens");
}

export function decimalToBaseUnits(value: DecimalAmountInput, decimals: number, label = "amount"): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError("decimals must be an integer between 0 and 255");
  }

  const text = normalizeDecimalInput(value, label);
  const [whole = "", fraction = ""] = text.split(".");
  const meaningfulFraction = fraction.replace(/0+$/, "");
  if (meaningfulFraction.length > decimals) {
    throw new RangeError(`${label} has too many decimal places for ${decimals} decimals`);
  }

  const wholeDigits = whole.replace(/^0+(?=\d)/, "");
  const unitsText = `${wholeDigits}${meaningfulFraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  const units = BigInt(unitsText === "" ? "0" : unitsText);
  if (units > MAX_U64) {
    throw new RangeError(`${label} exceeds u64 max`);
  }
  return units;
}

function normalizeDecimalInput(value: DecimalAmountInput, label: string): string {
  const text = typeof value === "number" ? decimalNumberToString(value, label) : value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw new RangeError(`${label} must be a non-negative decimal number`);
  }
  return text;
}

function decimalNumberToString(value: number, label: string): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
  const text = String(value);
  if (!/[eE]/.test(text)) {
    return text;
  }

  const [coefficient = "", exponentText = ""] = text.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent)) {
    throw new RangeError(`${label} must be a non-negative decimal number`);
  }
  const [whole = "", fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+/, "") || "0";
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) {
    return `0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}
