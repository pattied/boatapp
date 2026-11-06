import { checkPasscode } from "@/lib/auth";
import { failure, json, readJpeg } from "@/lib/http";
import { isJobId } from "@/lib/ids";
import { addPhoto, jobExists } from "@/lib/storage";

// Stores the branded before/after image the crew phone composed.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkPasscode(req)) return json({ error: "Wrong passcode." }, 401);
  const { id } = await ctx.params;
  if (!isJobId(id)) return json({ error: "Job not found." }, 404);
  try {
    const jpeg = await readJpeg(req);
    if (typeof jpeg === "string") return json({ error: jpeg }, 400);
    if (!(await jobExists(id))) return json({ error: "Job not found." }, 404);
    const image = await addPhoto(id, "share", jpeg);
    return json({ shareImage: image.src }, 201);
  } catch (err) {
    return failure(err);
  }
}
