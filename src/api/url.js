// Browser builds keep relative URLs; packaged native builds call the existing public API.
export function apiRequestUrl(path, origin = "") {
  return origin && path.startsWith("/api/") ? new URL(path, origin).href : path;
}
