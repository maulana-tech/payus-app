export function payUrl(origin: string, owner: string, slug?: string): string {
  return slug ? `${origin}/pay/${owner}/${slug}` : `${origin}/pay/${owner}`;
}
