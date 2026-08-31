// The cosmetics store — buys preset username colors with points (see
// components/CosmeticsStoreDialog.tsx, the only caller of the functions
// below). Mirrors server/cosmeticsCatalog.ts: the catalog itself is never
// hardcoded here, only fetched, so a new product added on the server shows
// up here with no client change at all.

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";

export type CosmeticProductType = "name_color";

export type CosmeticProduct = {
  id: string;
  type: CosmeticProductType;
  label: string;
  price: number;
  value: string;
};

export type CosmeticsCatalogResponse = {
  catalog: CosmeticProduct[];
  ownedCosmetics: string[];
  equippedNameColor: string | null;
};

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return (data && typeof data === "object" && "error" in data && String(data.error)) || fallback;
}

// The catalog plus (for a signed-in account) its current inventory — one
// request, so opening the store never needs a second round trip just to know
// what it already owns. A guest, or nobody at all, still gets the catalog
// back with an empty inventory: there's nothing to buy without an account
// (see the server's account-only guard on the purchase route below).
export async function fetchCosmeticsCatalog(): Promise<CosmeticsCatalogResponse> {
  const token = getAccountToken();
  const res = await fetch(`${getSignalingHttpBase()}/cosmetics`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Não foi possível carregar a loja.");
  return (await res.json()) as CosmeticsCatalogResponse;
}

export type PurchaseCosmeticResult = {
  points: number;
  ownedCosmetics: string[];
  equippedNameColor: string | null;
};

export async function purchaseCosmetic(productId: string): Promise<PurchaseCosmeticResult> {
  const token = getAccountToken();
  if (!token) throw new Error("Crie uma conta para comprar itens da loja.");
  const res = await fetch(`${getSignalingHttpBase()}/cosmetics/${encodeURIComponent(productId)}/buy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Falha ao comprar o item."));
  return (await res.json()) as PurchaseCosmeticResult;
}

// Switches which owned name color is active — free, since buying already
// spent the points (see purchaseCosmetic above); this only changes which
// owned one shows. `productId: null` un-equips.
export async function equipCosmetic(productId: string | null): Promise<{ equippedNameColor: string | null }> {
  const token = getAccountToken();
  if (!token) throw new Error("Crie uma conta para usar a loja.");
  const res = await fetch(`${getSignalingHttpBase()}/cosmetics/equip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ productId }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Falha ao equipar o item."));
  return (await res.json()) as { equippedNameColor: string | null };
}
