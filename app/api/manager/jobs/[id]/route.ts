import { checkManager } from "@/lib/auth";
import { failure, json } from "@/lib/http";
import { isJobId } from "@/lib/ids";
import { deleteJob } from "@/lib/storage";

// Deletes a job and all its photos. Customer links to it stop working.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkManager(req)) return json({ error: "Wrong manager passcode." }, 401);
  const { id } = await ctx.params;
  if (!isJobId(id)) return json({ error: "Job not found." }, 404);
  try {
    await deleteJob(id);
    return json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
