export const KIND_IMAGE: Record<string, string> = {
  airport: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=1200&auto=format&fit=crop",
  tour: "https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=1200&auto=format&fit=crop",
  consulting: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&auto=format&fit=crop",
  banking: "https://images.unsplash.com/photo-1601597111158-2fceff292cdc?w=1200&auto=format&fit=crop",
  meeting: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1200&auto=format&fit=crop",
};

export const FALLBACK_SERVICE_IMAGE =
  "https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=1200&auto=format&fit=crop";

export function getServiceImage(s: { image_url?: string | null; kind?: string | null }) {
  return s.image_url || KIND_IMAGE[s.kind ?? ""] || FALLBACK_SERVICE_IMAGE;
}
