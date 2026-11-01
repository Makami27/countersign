const SUI_ADDRESS = /^0x[0-9a-f]{64}$/;

export const ADDRESS_PROBLEM = "That isn't a full Sui address: 0x followed by 64 letters a–f and digits. Copy it again from the wallet. Nothing was changed.";

export function cleanAddress(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function isSuiAddress(value: string): boolean {
  return SUI_ADDRESS.test(cleanAddress(value));
}

export function attachAddressCleaning(input: HTMLInputElement): void {
  input.addEventListener("change", () => {
    input.value = cleanAddress(input.value);
  });
}
