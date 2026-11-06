import { PHOTO_PATH } from "@/lib/ids";
import { failure } from "@/lib/http";
import { readFile } from "@/lib/storage";

// Serves stored photos from this site's own address, so the Blob store can stay private
// and the browser can draw photos onto a canvas. Paths never change, so the CDN caches them.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const pathname = path.join("/");
  if (!PHOTO_PATH.test(pathname)) return new Response("Not found", { status: 404 });
  try {
    const file = await readFile(pathname);
    if (!file) return new Response("Not found", { status: 404 });
    const headers = new Headers({
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "x-robots-tag": "noindex",
    });
    if (new URL(req.url).searchParams.has("dl")) {
      headers.set("content-disposition", 'attachment; filename="before-after.jpg"');
    }
    return new Response(file.body as BodyInit, { headers });
  } catch (err) {
    return failure(err);
  }
}
