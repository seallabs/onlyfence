/** Maximum safe integer for BigInt-to-Number conversion (2^53 - 1) */
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Safely convert a bigint to a number, throwing if precision would be lost.
 *
 * @param value - BigInt value to convert
 * @returns The value as a number
 * @throws Error if the value exceeds Number.MAX_SAFE_INTEGER
 */
export function safeBigIntToNumber(value: bigint): number {
  if (value > MAX_SAFE_BIGINT) {
    throw new Error(
      `Amount ${value.toString()} exceeds maximum safe integer (${Number.MAX_SAFE_INTEGER}). ` +
        `USD value calculation would lose precision.`,
    );
  }
  return Number(value);
}

/**
 * Parse a string amount to bigint. Supports integer and decimal notation.
 * Decimal values are truncated to integers (smallest unit).
 *
 * @param value - String representation of the amount
 * @returns Parsed bigint value
 * @throws Error if the value is not a valid positive number or is zero
 */
export function parseBigIntAmount(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount "${value}": must be a positive number`);
  }

  const integerPart = trimmed.split('.')[0];
  if (integerPart === undefined || integerPart === '') {
    throw new Error(`Invalid amount "${value}": must be a positive number`);
  }

  const result = BigInt(integerPart);
  if (result === 0n) {
    throw new Error(`Invalid amount "${value}": must be greater than zero`);
  }

  return result;
}
