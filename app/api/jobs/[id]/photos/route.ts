import { checkPasscode } from "@/lib/auth";
import { failure, json, readJpeg } from "@/lib/http";
import { isJobId } from "@/lib/ids";
import { addPhoto, deletePhoto, jobExists, type PhotoKind } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  if (!checkPasscode(req)) return json({ error: "Wrong passcode." }, 401);
  const { id } = await ctx.params;
  const kind = new URL(req.url).searchParams.get("kind");
  if (!isJobId(id)) return json({ error: "Job not found." }, 404);
  if (kind !== "before" && kind !== "after") return json({ error: "Kind must be before or after." }, 400);
  try {
    const jpeg = await readJpeg(req);
    if (typeof jpeg === "string") return json({ error: jpeg }, 400);
    if (!(await jobExists(id))) return json({ error: "Job not found." }, 404);
    const photo = await addPhoto(id, kind as PhotoKind, jpeg);
    return json({ photo }, 201);
  } catch (err) {
    return failure(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!checkPasscode(req)) return json({ error: "Wrong passcode." }, 401);
  const { id } = await ctx.params;
  const pathname = new URL(req.url).searchParams.get("pathname") ?? "";
  if (!isJobId(id)) return json({ error: "Job not found." }, 404);
  try {
    await deletePhoto(id, pathname);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Invalid photo path") return json({ error: err.message }, 400);
    return failure(err);
  }
}
