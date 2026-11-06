import { failure, json } from "@/lib/http";
import { getJob } from "@/lib/storage";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const job = await getJob(id);
    if (!job) return json({ error: "Job not found." }, 404);
    return json({ job });
  } catch (err) {
    return failure(err);
  }
}
