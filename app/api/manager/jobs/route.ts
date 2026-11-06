import { checkManager } from "@/lib/auth";
import { failure, json } from "@/lib/http";
import { listJobs } from "@/lib/storage";

export async function GET(req: Request) {
  if (!checkManager(req)) return json({ error: "Wrong manager passcode." }, 401);
  try {
    return json({ jobs: await listJobs() });
  } catch (err) {
    return failure(err);
  }
}
