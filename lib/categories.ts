/*
  分類。docs/PLAN.md §4.3

  必須ではない。null は「あとで分類する」で、これはちゃんとした状態として扱う。
  間違った分類が入るより、未分類と分かっているほうが価値が高い（§4.8(4)）。
*/
export type Category = { id: string; name: string };

export const CATEGORIES: readonly Category[] = [
  { id: "food", name: "食費" },
  { id: "eatout", name: "外食" },
  { id: "daily", name: "日用品" },
  { id: "transit", name: "交通" },
  { id: "hobby", name: "趣味" },
  { id: "sub", name: "サブスク" },
  { id: "health", name: "医療" },
  { id: "other", name: "その他" },
];

export const UNCATEGORIZED_LABEL = "あとで分類する";

export function categoryName(id: string | null): string {
  if (id === null) return UNCATEGORIZED_LABEL;
  return CATEGORIES.find((c) => c.id === id)?.name ?? "不明な分類";
}
