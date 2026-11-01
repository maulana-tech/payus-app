// The HTML a merchant pastes into their site to load public/embed.js.

export type EmbedConfig = {
  to?: string; // username, without "@"
  link?: string;
  invoice?: string;
  amount?: string;
  mode?: "button" | "inline";
  theme?: "light" | "dark";
  label?: string;
};

const attr = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

export function embedSnippet(origin: string, cfg: EmbedConfig): string {
  const attrs: [string, string | undefined][] = [
    ["data-to", cfg.to ? `@${cfg.to}` : undefined],
    ["data-link", cfg.link],
    ["data-invoice", cfg.invoice],
    ["data-amount", cfg.link ? undefined : cfg.amount],
    ["data-mode", cfg.mode === "inline" ? "inline" : undefined],
    ["data-theme", cfg.theme],
    ["data-label", cfg.label],
  ];
  const rendered = attrs
    .filter(([, v]) => v)
    .map(([k, v]) => `\n        ${k}="${attr(v as string)}"`)
    .join("");
  return `<script src="${origin}/embed.js" async${rendered}></script>`;
}
