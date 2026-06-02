export function formatCurrencyPrefix(currency: string | null | undefined): string {
  const code = (currency ?? "").trim().toLowerCase();
  if (!code || code === "usd") return "$";
  return `${code.toUpperCase()} `;
}
